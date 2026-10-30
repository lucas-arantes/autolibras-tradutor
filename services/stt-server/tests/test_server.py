from __future__ import annotations

import json

import numpy as np
import pytest
from conftest import FakeEngine, chunks, silence, tone
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from autolibras_stt.config import Settings
from autolibras_stt.server import create_app
from autolibras_stt.vad import energy_vad


@pytest.fixture
def client(engine: FakeEngine) -> TestClient:
    return TestClient(create_app(engine, energy_vad(), Settings()))


def receive_until(ws, kind: str, limit: int = 50) -> list[dict]:  # noqa: ANN001
    messages = []
    for _ in range(limit):
        message = ws.receive_json()
        messages.append(message)
        if message["type"] == kind:
            return messages
    raise AssertionError(f"não recebeu {kind}: {messages}")


def test_health(client: TestClient) -> None:
    assert client.get("/health").json() == {
        "status": "ok",
        "model": "fake",
        "language": "pt",
        "sessions": 0,
        "tokenRequired": False,
        "web": False,
    }


def test_fluxo_completo(client: TestClient) -> None:
    with client.websocket_connect("/v1/stream") as ws:
        assert ws.receive_json() == {
            "type": "ready",
            "model": "fake",
            "language": "pt",
            "sampleRate": 16000,
        }
        for chunk in chunks(np.concatenate([tone(2), silence(1)])):
            ws.send_bytes(chunk)
        messages = receive_until(ws, "final")
        assert {m["type"] for m in messages} == {"partial", "final"}
        assert messages[-1]["id"] == "s1"

        for chunk in chunks(tone(1)):
            ws.send_bytes(chunk)
        ws.send_text(json.dumps({"type": "stop"}))
        messages = receive_until(ws, "stopped")
        finals = [m for m in messages if m["type"] == "final"]
        assert [f["id"] for f in finals] == ["s2"]


def test_audio_invalido_gera_erro_sem_derrubar(client: TestClient) -> None:
    with client.websocket_connect("/v1/stream") as ws:
        ws.receive_json()
        ws.send_bytes(b"\x00\x01\x02")
        assert ws.receive_json()["type"] == "error"
        ws.send_text("isso não é json")
        assert ws.receive_json() == {"type": "error", "message": "Mensagem desconhecida"}


@pytest.mark.parametrize(
    ("origin", "allowed"),
    [
        ("http://localhost:5173", True),
        ("http://127.0.0.1:4173", True),
        ("https://lucas-arantes.github.io", True),
        ("chrome-extension://abcdefghijklmnopabcdefghijklmnop", True),
        ("https://site-qualquer.example", False),
    ],
)
def test_origem(client: TestClient, origin: str, allowed: bool) -> None:
    if allowed:
        with client.websocket_connect("/v1/stream", headers={"origin": origin}) as ws:
            assert ws.receive_json()["type"] == "ready"
    else:
        with (
            pytest.raises(WebSocketDisconnect) as error,
            client.websocket_connect("/v1/stream", headers={"origin": origin}) as ws,
        ):
            ws.receive_json()
        assert error.value.code == 1008


def test_origens_configuraveis() -> None:
    settings = Settings(allowed_origins=("https://meu-site.example",))
    assert settings.origin_allowed("https://meu-site.example")
    assert not settings.origin_allowed("http://localhost:5173")
    assert Settings(allowed_origins=("*",)).origin_allowed("https://qualquer.example")
