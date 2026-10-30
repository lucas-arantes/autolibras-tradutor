from __future__ import annotations

import json
import os
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
from autolibras_stt.sessions import AudioClock
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


def test_serve_o_app_web_e_o_pacote_de_sinais(tmp_path: Path) -> None:
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<p>AutoLibras</p>")
    (web / "broadcast.html").write_text("<p>overlay</p>")
    signs = tmp_path / "sinais"
    signs.mkdir()
    (signs / "manifest.json").write_text('{"signs": {}}')
    with make_client(tmp_path, web_dir=str(web), signs_dir=str(signs)) as client:
        assert "AutoLibras" in client.get("/").text
        assert "overlay" in client.get("/broadcast.html").text
        assert client.get("/signs/manifest.json").json() == {"signs": {}}
        health = client.get("/health").json()
        assert health["web"] is True
        assert health["signs"] is True


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


def test_finais_trazem_o_horario_da_fala_e_a_latencia(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        created = client.post("/v1/sessions", json={"source": {"type": "audio"}}).json()
        with (
            client.websocket_connect(created["events"]) as overlay,
            client.websocket_connect(created["ingest"]) as studio,
        ):
            hello = overlay.receive_json()
            assert hello["serverTime"] > 0
            studio.receive_json()
            for chunk in chunks(SPEECH):
                studio.send_bytes(chunk)
            final = collect(overlay, "final")[-1]
        assert final["wallStart"] < final["wallEnd"] <= final["serverTime"]
        # No teste o áudio chega todo de uma vez, então a fala "começou" há pouco.
        assert final["serverTime"] - final["wallStart"] < 5
        latency = client.get(f"/v1/sessions/{created['id']}").json()["latency"]
        assert latency["count"] >= 1
        assert latency["recommendedDelay"] >= 1


def test_sessao_de_texto_recebe_legendas(tmp_path: Path) -> None:
    with make_client(tmp_path, token="segredo") as client:
        headers = {"Authorization": "Bearer segredo"}
        created = client.post(
            "/v1/sessions", json={"source": {"type": "text"}}, headers=headers
        ).json()
        with client.websocket_connect(created["events"]) as overlay:
            overlay.receive_json()
            assert client.post(created["text"], json={"text": "Boa"}).status_code == 401
            client.post(created["text"], json={"text": "Boa", "final": False}, headers=headers)
            client.post(created["text"], json={"text": " Boa  noite. "}, headers=headers)
            assert overlay.receive_json()["state"] == "live"
            assert overlay.receive_json() == {
                "type": "partial",
                "id": "t1",
                "text": "Boa",
                "stable": "",
            }
            final = overlay.receive_json()
            assert (final["type"], final["id"], final["text"]) == ("final", "t1", "Boa noite.")
            with client.websocket_connect(f"{created['ingest']}?token=segredo") as typist:
                typist.receive_json()
                typist.send_json({"type": "text", "text": "Tudo bem?"})
                assert typist.receive_json()["id"] == "t2"
                assert overlay.receive_json()["text"] == "Tudo bem?"


def test_relogio_do_audio_usa_a_chegada_mais_cedo_da_janela() -> None:
    now = [1000.0]
    clock = AudioClock(window_s=10, now=lambda: now[0])
    assert clock.wall(1) is None
    clock.observe(1.0)  # 1 s de áudio chegou em 1000,0: começou em 999,0
    now[0] = 1002.5
    clock.observe(2.0)  # chegou atrasado: daria 1000,5
    assert clock.wall(0) == 999.0
    # O envio parou 20 s e o áudio desse tempo se perdeu: a janela esquece o começo.
    now[0] = 1030.0
    clock.observe(3.0)
    assert clock.wall(3.0) == 1030.0


def test_sessao_le_a_legenda_do_hls(tmp_path: Path) -> None:
    (tmp_path / "master.m3u8").write_text(
        "#EXTM3U\n"
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",LANGUAGE="pt",URI="subs.m3u8"\n'
        '#EXT-X-STREAM-INF:BANDWIDTH=1,SUBTITLES="s"\nvideo.m3u8\n'
    )
    (tmp_path / "subs.m3u8").write_text(
        "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nseg0.vtt\n#EXT-X-ENDLIST\n"
    )
    (tmp_path / "seg0.vtt").write_text(
        "WEBVTT\n\n00:00:00.500 --> 00:00:02.000\nBoa noite a todos.\n\n"
        "00:00:02.000 --> 00:00:03.000\nAté amanhã\n"
    )
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(tmp_path))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with make_client(tmp_path) as client:
            url = f"http://127.0.0.1:{server.server_port}/master.m3u8"
            source = {"type": "url", "url": url, "captions": True}
            created = client.post("/v1/sessions", json={"source": source}).json()
            assert created["captions"] is True
            with client.websocket_connect(created["events"]) as overlay:
                seen = collect(overlay, "ended")
            finals = [m["text"] for m in seen if m["type"] == "final"]
            assert finals == ["Boa noite a todos.", "Até amanhã"]
    finally:
        server.shutdown()


CC_SAMPLE = os.environ.get("AUTOLIBRAS_CC_SAMPLE", "")


@pytest.mark.skipif(
    not (CC_SAMPLE and shutil.which("ffmpeg")),
    reason="defina AUTOLIBRAS_CC_SAMPLE com um vídeo com closed caption",
)
def test_le_o_closed_caption_embutido_no_video(tmp_path: Path) -> None:
    sample = Path(CC_SAMPLE)
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(sample.parent))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        app = create_app(FakeEngine(), energy_vad(), Settings(), ffmpeg="ffmpeg")
        with TestClient(app) as client:
            url = f"http://127.0.0.1:{server.server_port}/{sample.name}"
            source = {"type": "url", "url": url, "captions": True}
            created = client.post("/v1/sessions", json={"source": source}).json()
            with client.websocket_connect(created["events"]) as overlay:
                seen = collect(overlay, "ended", limit=2_000)
        finals = [m["text"] for m in seen if m["type"] == "final"]
        assert finals, seen[-3:]
        assert all("inaudible" not in text and ">>" not in text for text in finals)
    finally:
        server.shutdown()


def test_retorno_do_publico(tmp_path: Path) -> None:
    data = tmp_path / "dados"
    with make_client(tmp_path, token="segredo", data_dir=str(data)) as client:
        headers = {"Authorization": "Bearer segredo"}
        created = client.post("/v1/sessions", json={"source": {"type": "audio"}}, headers=headers)
        key = created.json()["feedbackKey"]
        assert len(key) == 16 and key not in created.json()["id"]
        # Sem token, como texto (navigator.sendBeacon).
        sent = client.post(
            "/v1/feedback",
            content=json.dumps({"rating": "bad", "key": key, "comment": "  rápido   demais "}),
            headers={"Content-Type": "text/plain"},
        )
        assert sent.status_code == 204
        client.post("/v1/feedback", json={"rating": "good", "key": key, "source": "player"})
        client.post("/v1/feedback", json={"rating": "good"})
        assert client.post("/v1/feedback", json={"rating": "talvez"}).status_code == 400
        assert client.get(f"/v1/feedback?key={key}").status_code == 401
        listed = client.get(f"/v1/feedback?key={key}", headers=headers).json()
        assert listed["summary"] == {"good": 1, "bad": 1}
        assert listed["items"][1]["comment"] == "rápido demais"
    # Os retornos sobrevivem ao reinício.
    with make_client(tmp_path, token="segredo", data_dir=str(data)) as client:
        listed = client.get("/v1/feedback", headers={"Authorization": "Bearer segredo"}).json()
        assert listed["summary"] == {"good": 2, "bad": 1}


def test_limita_envios_de_retorno_por_endereco(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        codes = [
            client.post("/v1/feedback", json={"rating": "good"}).status_code for _ in range(12)
        ]
        assert codes[:10] == [204] * 10
        assert codes[10:] == [429, 429]
