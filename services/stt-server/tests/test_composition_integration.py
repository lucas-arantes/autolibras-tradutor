"""Composição de ponta a ponta: OBS → RTMP → servidor → vídeo com a janela → RTMP.

Usa ffmpeg, Chromium e o build do app web (`npm run build -w @autolibras/web`), e
baixa sinais do pacote publicado. Roda só com AUTOLIBRAS_INTEGRATION=1 e um vídeo
H.264/AAC em AUTOLIBRAS_TEST_VIDEO.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import threading
import time
import urllib.request
from pathlib import Path

import pytest
import uvicorn
from conftest import FakeEngine

from autolibras_stt.composer import composition_available
from autolibras_stt.config import Settings
from autolibras_stt.server import create_app
from autolibras_stt.vad import energy_vad

WEB_DIR = Path(__file__).resolve().parents[3] / "apps" / "web" / "dist"
VIDEO = os.environ.get("AUTOLIBRAS_TEST_VIDEO", "")

pytestmark = pytest.mark.skipif(
    os.environ.get("AUTOLIBRAS_INTEGRATION") != "1"
    or not VIDEO
    or not (WEB_DIR / "broadcast.html").is_file()
    or composition_available("ffmpeg", "") is not None,
    reason="precisa de AUTOLIBRAS_INTEGRATION=1, AUTOLIBRAS_TEST_VIDEO, ffmpeg, Chromium e o app",
)


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def request(url: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.loads(response.read() or b"{}")


def test_obs_envia_por_rtmp_e_sai_com_a_janela_de_libras(tmp_path: Path) -> None:
    port, rtmp_port, sink_port = free_port(), free_port(), free_port()
    engine = FakeEngine(["Bom dia a todos."] * 50)
    settings = Settings(port=port, rtmp_port=rtmp_port, web_dir=str(WEB_DIR))
    server = uvicorn.Server(
        uvicorn.Config(create_app(engine, energy_vad(), settings), port=port, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.05)
    output = tmp_path / "saida.flv"
    sink = subprocess.Popen(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-listen", "1"]
        + ["-i", f"rtmp://127.0.0.1:{sink_port}/live/saida", "-c", "copy", str(output)]
    )
    obs: subprocess.Popen[bytes] | None = None
    try:
        base = f"http://127.0.0.1:{port}"
        assert request(f"{base}/health")["composition"] is True
        created = request(
            f"{base}/v1/sessions",
            {
                "source": {"type": "rtmp"},
                "composition": {"output": f"rtmp://127.0.0.1:{sink_port}/live/saida", "delay": 3},
            },
        )
        rtmp = created["rtmp"]
        target = f"{rtmp['server'].replace('testserver', '127.0.0.1')}/{rtmp['key']}"
        time.sleep(1)
        # O "OBS": manda o vídeo na velocidade normal para o endereço da sessão.
        obs = subprocess.Popen(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-re", "-i", VIDEO]
            + ["-c", "copy", "-f", "flv", target]
        )
        obs.wait(timeout=120)
        deadline = time.time() + 60
        while time.time() < deadline:
            info = request(f"{base}/v1/sessions/{created['id']}")
            if info["state"] in ("ended", "error"):
                break
            time.sleep(1)
        assert info["state"] == "ended", info
        assert info["composition"]["frames"] > 100
        sink.wait(timeout=30)
    finally:
        for process in (obs, sink):
            if process and process.poll() is None:
                process.kill()
        server.should_exit = True
        # Espera o servidor (e a composição) terminar antes de o Python sair.
        thread.join(timeout=30)

    probe = json.loads(
        subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,width,height"]
            + ["-of", "json", str(output)],
            capture_output=True,
            check=True,
            text=True,
        ).stdout
    )
    codecs = {s["codec_name"]: s for s in probe["streams"]}
    assert codecs["h264"]["width"] == 1280 and codecs["h264"]["height"] == 720
    assert "aac" in codecs
    # Na região da janela (canto inferior direito), a imagem não é lisa: há um avatar.
    frame = tmp_path / "quadro.gray"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-ss", "4", "-i", str(output), "-frames:v", "1"]
        + ["-vf", "crop=270:360:988:338", "-f", "rawvideo", "-pix_fmt", "gray", str(frame)],
        check=True,
    )
    pixels = frame.read_bytes()
    assert len(set(pixels)) > 40
