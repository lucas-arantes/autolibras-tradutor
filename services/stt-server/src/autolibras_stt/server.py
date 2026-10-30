"""Servidor HTTP/WebSocket. Veja o protocolo em `protocol.py`."""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import FastAPI, WebSocket
from starlette.websockets import WebSocketDisconnect, WebSocketState

from . import protocol
from .config import Settings
from .engine import Engine
from .streaming import StreamingOptions, StreamingSession
from .vad import Vad

log = logging.getLogger("autolibras_stt")

# 10 s de áudio por mensagem é muito mais do que um cliente normal manda (100–250 ms).
MAX_CHUNK_BYTES = 10 * protocol.SAMPLE_RATE * 2


def create_app(
    engine: Engine,
    vad: Vad,
    settings: Settings | None = None,
    options: StreamingOptions | None = None,
) -> FastAPI:
    settings = settings or Settings()
    app = FastAPI(title="AutoLibras STT")
    semaphore = asyncio.Semaphore(settings.max_concurrency)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "model": engine.name, "language": settings.language}

    @app.websocket("/v1/stream")
    async def stream(websocket: WebSocket) -> None:
        origin = websocket.headers.get("origin")
        if not settings.origin_allowed(origin):
            log.warning("Origem recusada: %s", origin)
            await websocket.close(code=1008)
            return

        await websocket.accept()
        session = StreamingSession(engine, vad, options)

        async def run(step) -> None:  # noqa: ANN001
            async with semaphore:
                events = await asyncio.to_thread(step)
            for event in events:
                await websocket.send_json(event.to_json())

        await websocket.send_json(protocol.ready(engine.name, settings.language))
        try:
            while True:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect":
                    return
                data = message.get("bytes")
                if data is not None:
                    if len(data) % 2 or len(data) > MAX_CHUNK_BYTES:
                        await websocket.send_json(protocol.error("Áudio inválido: use PCM 16 bits"))
                        continue
                    session.append(data)
                    if session.should_step():
                        await run(session.step)
                    continue
                try:
                    command = json.loads(message.get("text") or "{}")
                except json.JSONDecodeError:
                    command = {}
                if command.get("type") == "stop":
                    await run(session.flush)
                    await websocket.send_json(protocol.STOPPED)
                    await websocket.close()
                    return
                await websocket.send_json(protocol.error("Mensagem desconhecida"))
        except WebSocketDisconnect:
            return
        except Exception:
            log.exception("Erro na transcrição")
            if websocket.application_state == WebSocketState.CONNECTED:
                await websocket.send_json(protocol.error("Erro interno na transcrição"))
                await websocket.close(code=1011)

    return app
