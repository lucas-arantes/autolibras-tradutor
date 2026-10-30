"""Servidor HTTP/WebSocket. Veja o protocolo em `protocol.py` e as sessões em `sessions.py`."""

from __future__ import annotations

import asyncio
import fnmatch
import json
import logging
import secrets
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.websockets import WebSocketDisconnect, WebSocketState

from . import protocol
from .config import Settings
from .engine import Engine
from .sessions import Session, SessionError, SessionHub
from .streaming import StreamingOptions, StreamingSession
from .vad import Vad

log = logging.getLogger("autolibras_stt")

# 10 s de áudio por mensagem é muito mais do que um cliente normal manda (100–250 ms).
MAX_CHUNK_BYTES = 10 * protocol.SAMPLE_RATE * 2


class SourceRequest(BaseModel):
    type: Literal["audio", "url"]
    url: str | None = None
    # Vídeo gravado: o ffmpeg lê na velocidade real, como se fosse ao vivo.
    realtime: bool = False


class SessionRequest(BaseModel):
    source: SourceRequest
    # Id fixo escolhido pelo Estúdio, para a URL do overlay no OBS não mudar.
    # Se já existir, a sessão antiga é encerrada e substituída.
    id: str | None = None


def create_app(
    engine: Engine,
    vad: Vad,
    settings: Settings | None = None,
    options: StreamingOptions | None = None,
    ffmpeg: str = "ffmpeg",
) -> FastAPI:
    settings = settings or Settings()
    app = FastAPI(title="AutoLibras STT")
    semaphore = asyncio.Semaphore(settings.max_concurrency)

    async def run(step):  # noqa: ANN001, ANN202
        async with semaphore:
            return await asyncio.to_thread(step)

    hub = SessionHub(engine, vad, run, options, settings.max_sessions, ffmpeg)
    app.state.hub = hub

    # O Estúdio pode ser aberto de outra origem (o site publicado) e chama a API REST.
    origin_regex = "|".join(
        ".*" if pattern == "*" else fnmatch.translate(pattern).removesuffix(r"\Z")
        for pattern in settings.allowed_origins
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=f"^({origin_regex})$" if origin_regex else None,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    def authorized(header: str | None, query: str | None) -> bool:
        if not settings.token:
            return True
        supplied = query or (header or "").removeprefix("Bearer ").strip()
        return secrets.compare_digest(supplied, settings.token)

    def require_token(request: Request) -> None:
        if not authorized(request.headers.get("authorization"), request.query_params.get("token")):
            raise HTTPException(status_code=401, detail="Token inválido ou ausente")

    async def accept(websocket: WebSocket) -> bool:
        origin = websocket.headers.get("origin")
        if not settings.origin_allowed(origin, websocket.headers.get("host")):
            log.warning("Origem recusada: %s", origin)
            await websocket.close(code=1008)
            return False
        await websocket.accept()
        return True

    web_served = bool(settings.web_dir) and Path(settings.web_dir).is_dir()
    signs_served = (
        bool(settings.signs_dir) and (Path(settings.signs_dir) / "manifest.json").is_file()
    )

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "model": engine.name,
            "language": settings.language,
            "sessions": len(hub.sessions),
            "tokenRequired": bool(settings.token),
            "web": web_served,
            "signs": signs_served,
        }

    # Transcrição avulsa ------------------------------------------------------

    @app.websocket("/v1/stream")
    async def stream(websocket: WebSocket) -> None:
        if not await accept(websocket):
            return
        session = StreamingSession(engine, vad, options)

        async def send(events: list[protocol.Event]) -> None:
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
                        await send(await run(session.step))
                    continue
                if _command(message) == "stop":
                    await send(await run(session.flush))
                    await websocket.send_json(protocol.STOPPED)
                    await websocket.close()
                    return
                await websocket.send_json(protocol.error("Mensagem desconhecida"))
        except WebSocketDisconnect:
            return
        except Exception:
            log.exception("Erro na transcrição")
            await _close_with_error(websocket)

    # Sessões de transmissão --------------------------------------------------

    def find(session_id: str) -> Session:
        session = hub.get(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Sessão não encontrada")
        return session

    @app.post("/v1/sessions", status_code=201)
    async def create_session(body: SessionRequest, request: Request) -> dict[str, Any]:
        require_token(request)
        if body.id and hub.get(body.id):
            await hub.delete(body.id)
        try:
            session = hub.create(
                body.source.type, body.source.url, body.source.realtime, session_id=body.id
            )
        except SessionError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        links = {"events": f"/v1/sessions/{session.id}/events"}
        if session.source == "audio":
            links["ingest"] = f"/v1/sessions/{session.id}/ingest"
        return {**session.info(), **links}

    @app.get("/v1/sessions")
    async def list_sessions(request: Request) -> list[dict[str, Any]]:
        require_token(request)
        return [session.info() for session in hub.sessions.values()]

    @app.get("/v1/sessions/{session_id}")
    async def get_session(session_id: str) -> dict[str, Any]:
        # Sem token: quem tem o id (o overlay) pode ver o estado.
        return find(session_id).info()

    @app.delete("/v1/sessions/{session_id}", status_code=204)
    async def delete_session(session_id: str, request: Request) -> Response:
        require_token(request)
        if not await hub.delete(session_id):
            raise HTTPException(status_code=404, detail="Sessão não encontrada")
        return Response(status_code=204)

    @app.websocket("/v1/sessions/{session_id}/ingest")
    async def ingest(websocket: WebSocket, session_id: str) -> None:
        """Mesmo protocolo de /v1/stream; os eventos também vão para os assinantes."""
        if not await accept(websocket):
            return
        if not authorized(None, websocket.query_params.get("token")):
            await websocket.close(code=1008, reason="Token inválido ou ausente")
            return
        session = hub.get(session_id)
        if not session or session.source != "audio":
            await websocket.close(code=1008, reason="Sessão de áudio não encontrada")
            return
        if session.ingest_connected:
            await websocket.close(code=1013, reason="A sessão já recebe áudio de outra conexão")
            return
        session.ingest_connected = True
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
                    for event in await hub.feed(session, data):
                        await websocket.send_json(event.to_json())
                    continue
                if _command(message) == "stop":
                    for event in await hub.flush(session):
                        await websocket.send_json(event.to_json())
                    await websocket.send_json(protocol.STOPPED)
                    await websocket.close()
                    return
                await websocket.send_json(protocol.error("Mensagem desconhecida"))
        except WebSocketDisconnect:
            return
        except Exception:
            log.exception("Erro na sessão %s", session.id)
            await _close_with_error(websocket)
        finally:
            session.ingest_connected = False

    @app.websocket("/v1/sessions/{session_id}/events")
    async def events(websocket: WebSocket, session_id: str) -> None:
        if not await accept(websocket):
            return
        session = hub.get(session_id)
        if not session:
            await websocket.close(code=1008, reason="Sessão não encontrada")
            return
        queue = hub.subscribe(session)
        await websocket.send_json({"type": "session", **session.info()})
        receiver = asyncio.create_task(_drain(websocket))
        try:
            while not receiver.done():
                getter = asyncio.create_task(queue.get())
                done, _ = await asyncio.wait(
                    {getter, receiver}, return_when=asyncio.FIRST_COMPLETED
                )
                if getter not in done:
                    getter.cancel()
                    break
                message = getter.result()
                await websocket.send_json(message)
                if message.get("state") == "ended" and hub.get(session_id) is not session:
                    # Sessão apagada: o overlay reconecta e espera a próxima com o mesmo id.
                    await websocket.close()
                    break
        except WebSocketDisconnect:
            pass
        finally:
            receiver.cancel()
            hub.unsubscribe(session, queue)

    if signs_served:
        # Pacote de sinais GPL do avatar próprio, gerado à parte (fora deste repositório).
        app.mount("/signs", StaticFiles(directory=settings.signs_dir), name="signs")
    if web_served:
        # Depois das rotas da API: o resto do caminho é o app (index, estúdio, overlay).
        app.mount("/", StaticFiles(directory=settings.web_dir, html=True), name="web")

    return app


def _command(message: dict[str, Any]) -> str | None:
    try:
        data = json.loads(message.get("text") or "{}")
    except json.JSONDecodeError:
        return None
    return data.get("type") if isinstance(data, dict) else None


async def _drain(websocket: WebSocket) -> None:
    """Lê e descarta mensagens do assinante, só para notar quando ele desconecta."""
    while True:
        message = await websocket.receive()
        if message["type"] == "websocket.disconnect":
            return


async def _close_with_error(websocket: WebSocket) -> None:
    if websocket.application_state == WebSocketState.CONNECTED:
        await websocket.send_json(protocol.error("Erro interno na transcrição"))
        await websocket.close(code=1011)
