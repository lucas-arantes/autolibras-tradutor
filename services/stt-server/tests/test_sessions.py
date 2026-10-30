from __future__ import annotations

import shutil
import sys
import threading
import wave
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import pytest
from conftest import FakeEngine, chunks, pcm16, silence, tone
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from autolibras_stt.config import Settings
from autolibras_stt.server import create_app
from autolibras_stt.vad import energy_vad

SPEECH = np.concatenate([silence(0.5), tone(1.5), silence(1), tone(1), silence(1)])


def make_client(tmp_path: Path, **settings) -> TestClient:  # noqa: ANN003
    return TestClient(
        create_app(FakeEngine(), energy_vad(), Settings(**settings), ffmpeg=fake_ffmpeg(tmp_path))
    )


def fake_ffmpeg(tmp_path: Path) -> str:
    """Um "ffmpeg" que ignora os argumentos e escreve a fala de teste em PCM na saída."""
    audio = tmp_path / "speech.pcm"
    audio.write_bytes(pcm16(SPEECH))
    script = tmp_path / "fake-ffmpeg"
    body = f"import sys\nsys.stdout.buffer.write(open({str(audio)!r}, 'rb').read())\n"
    script.write_text(f"#!{sys.executable}\n{body}")
    script.chmod(0o755)
    return str(script)


def collect(ws, until: str, limit: int = 200) -> list[dict]:  # noqa: ANN001
    messages = []
    for _ in range(limit):
        message = ws.receive_json()
        messages.append(message)
        if message.get("type") == until or message.get("state") == until:
            return messages
    raise AssertionError(f"não chegou {until}: {messages}")


def test_sessao_de_audio_distribui_eventos_para_os_assinantes(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        created = client.post("/v1/sessions", json={"source": {"type": "audio"}}).json()
        assert created["state"] == "waiting"
        with (
            client.websocket_connect(created["events"]) as overlay,
            client.websocket_connect(created["ingest"]) as studio,
        ):
            assert overlay.receive_json()["type"] == "session"
            assert studio.receive_json()["type"] == "ready"
            for chunk in chunks(SPEECH):
                studio.send_bytes(chunk)
            # O estúdio recebe a transcrição de volta, e o overlay recebe o mesmo.
            assert collect(studio, "final")[-1]["id"] == "s1"
            seen = collect(overlay, "final")
            assert {"type": "state", "state": "live", "error": None} in seen
            assert seen[-1]["id"] == "s1"
        assert client.get(f"/v1/sessions/{created['id']}").json()["state"] == "live"


def test_so_uma_conexao_envia_audio_por_vez(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        created = client.post("/v1/sessions", json={"source": {"type": "audio"}}).json()
        with client.websocket_connect(created["ingest"]) as first:
            first.receive_json()
            with (
                pytest.raises(WebSocketDisconnect) as error,
                client.websocket_connect(created["ingest"]) as second,
            ):
                second.receive_json()
            assert error.value.code == 1013


def test_sessao_por_endereco_le_a_transmissao_com_ffmpeg(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        created = client.post(
            "/v1/sessions",
            json={"source": {"type": "url", "url": "rtmp://exemplo.test/live/chave"}},
        ).json()
        assert "ingest" not in created
        with client.websocket_connect(created["events"]) as overlay:
            seen = collect(overlay, "ended")
        finals = [m for m in seen if m["type"] == "final"]
        assert [f["id"] for f in finals] == ["s1", "s2"]


def test_recusa_enderecos_que_nao_sao_de_transmissao(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        for url in ["file:///etc/passwd", "/etc/passwd", "ftp://exemplo.test/a", "rtmp://"]:
            response = client.post("/v1/sessions", json={"source": {"type": "url", "url": url}})
            assert response.status_code == 400, url


def test_encerrar_avisa_os_assinantes(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        created = client.post("/v1/sessions", json={"source": {"type": "audio"}}).json()
        with client.websocket_connect(created["events"]) as overlay:
            overlay.receive_json()
            assert client.delete(f"/v1/sessions/{created['id']}").status_code == 204
            assert overlay.receive_json() == {"type": "state", "state": "ended", "error": None}
        assert client.get(f"/v1/sessions/{created['id']}").status_code == 404


def test_limite_de_sessoes(tmp_path: Path) -> None:
    with make_client(tmp_path, max_sessions=1) as client:
        assert client.post("/v1/sessions", json={"source": {"type": "audio"}}).status_code == 201
        response = client.post("/v1/sessions", json={"source": {"type": "audio"}})
        assert response.status_code == 400
        assert "Limite" in response.json()["detail"]


def test_token_protege_criacao_lista_e_audio(tmp_path: Path) -> None:
    with make_client(tmp_path, token="segredo") as client:
        assert client.post("/v1/sessions", json={"source": {"type": "audio"}}).status_code == 401
        assert client.get("/v1/sessions").status_code == 401
        headers = {"Authorization": "Bearer segredo"}
        created = client.post(
            "/v1/sessions", json={"source": {"type": "audio"}}, headers=headers
        ).json()
        assert client.get("/v1/sessions?token=segredo").status_code == 200
        # O overlay só precisa do id da sessão.
        with client.websocket_connect(created["events"]) as overlay:
            assert overlay.receive_json()["type"] == "session"
        with (
            pytest.raises(WebSocketDisconnect) as error,
            client.websocket_connect(created["ingest"]) as studio,
        ):
            studio.receive_json()
        assert error.value.code == 1008
        with client.websocket_connect(f"{created['ingest']}?token=segredo") as studio:
            assert studio.receive_json()["type"] == "ready"


def test_aceita_paginas_servidas_pelo_proprio_servidor(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        created = client.post("/v1/sessions", json={"source": {"type": "audio"}}).json()
        headers = {"origin": "http://192.168.0.10:8000", "host": "192.168.0.10:8000"}
        with client.websocket_connect(created["events"], headers=headers) as overlay:
            assert overlay.receive_json()["type"] == "session"


def test_serve_o_app_web(tmp_path: Path) -> None:
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<p>AutoLibras</p>")
    (web / "broadcast.html").write_text("<p>overlay</p>")
    with make_client(tmp_path, web_dir=str(web)) as client:
        assert "AutoLibras" in client.get("/").text
        assert "overlay" in client.get("/broadcast.html").text
        assert client.get("/health").json()["web"] is True


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="sem ffmpeg")
def test_ffmpeg_de_verdade_le_audio_por_http(tmp_path: Path) -> None:
    path = tmp_path / "fala.wav"
    with wave.open(str(path), "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(44_100)
        resampled = np.interp(
            np.arange(0, len(SPEECH), 16_000 / 44_100), np.arange(len(SPEECH)), SPEECH
        )
        file.writeframes(pcm16(resampled.astype(np.float32)))
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(tmp_path))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        app = create_app(FakeEngine(), energy_vad(), Settings(), ffmpeg="ffmpeg")
        with TestClient(app) as client:
            url = f"http://127.0.0.1:{server.server_port}/fala.wav"
            created = client.post(
                "/v1/sessions", json={"source": {"type": "url", "url": url}}
            ).json()
            with client.websocket_connect(created["events"]) as overlay:
                seen = collect(overlay, "ended")
        assert [m["id"] for m in seen if m["type"] == "final"] == ["s1", "s2"]
    finally:
        server.shutdown()


def test_id_fixo_substitui_a_sessao_antiga(tmp_path: Path) -> None:
    session_id = "estudio-da-ana-1234"
    with make_client(tmp_path) as client:
        first = client.post("/v1/sessions", json={"id": session_id, "source": {"type": "audio"}})
        assert first.json()["id"] == session_id
        with client.websocket_connect(first.json()["events"]) as overlay:
            overlay.receive_json()
            second = client.post(
                "/v1/sessions", json={"id": session_id, "source": {"type": "audio"}}
            )
            assert second.status_code == 201
            assert overlay.receive_json()["state"] == "ended"
            with pytest.raises(WebSocketDisconnect):
                overlay.receive_json()
        assert len(client.get("/v1/sessions").json()) == 1
        short = client.post("/v1/sessions", json={"id": "curto", "source": {"type": "audio"}})
        assert short.status_code == 400


def test_sessao_parada_e_encerrada_avisando_o_overlay(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        old = client.post("/v1/sessions", json={"source": {"type": "audio"}}).json()
        with client.websocket_connect(old["events"]) as overlay:
            overlay.receive_json()
            client.app.state.hub.get(old["id"]).last_activity -= 16 * 60
            client.post("/v1/sessions", json={"source": {"type": "audio"}})
            assert overlay.receive_json()["state"] == "ended"
            with pytest.raises(WebSocketDisconnect):
                overlay.receive_json()
        assert client.get(f"/v1/sessions/{old['id']}").status_code == 404
