"""Sessões de transmissão: uma entrada de áudio, vários assinantes.

Uma sessão recebe áudio por WebSocket (página Estúdio) ou lê uma transmissão
com o ffmpeg (RTMP, SRT, HLS), transcreve com a `StreamingSession` e distribui
parciais e finais para todos os assinantes, como o overlay do OBS. O id da
sessão é aleatório e funciona como chave de acesso do overlay.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import re
import secrets
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import urlparse

from . import protocol
from .engine import Engine
from .streaming import StreamingOptions, StreamingSession
from .vad import Vad

log = logging.getLogger("autolibras_stt.sessions")

SourceType = Literal["audio", "url"]
SessionState = Literal["waiting", "live", "ended", "error"]

# Protocolos que o ffmpeg pode abrir numa sessão por endereço. Arquivos locais
# e outros esquemas ficam de fora para o servidor não ler o próprio disco.
URL_SCHEMES = {"rtmp", "rtmps", "srt", "http", "https"}
FFMPEG_PROTOCOLS = "rtmp,rtmps,srt,http,https,tcp,tls,udp,crypto,hls,httpproxy"
CHUNK_BYTES = protocol.SAMPLE_RATE * 2 // 10  # 100 ms de PCM 16 bits
IDLE_SECONDS = 15 * 60
# O id é a chave do overlay: quem escolhe o próprio (para a URL do OBS não mudar)
# precisa de um id longo o bastante para não ser adivinhado.
SESSION_ID = re.compile(r"[A-Za-z0-9_-]{16,64}")


class SessionError(Exception):
    """Pedido inválido para uma sessão (vira 4xx na API)."""


def check_stream_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in URL_SCHEMES or not parsed.netloc:
        raise SessionError("Use um endereço rtmp://, rtmps://, srt://, http:// ou https://")
    return url


@dataclass(eq=False)
class Session:
    id: str
    source: SourceType
    url: str | None
    streaming: StreamingSession
    created_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)
    state: SessionState = "waiting"
    error: str | None = None
    ingest_connected: bool = False
    subscribers: set[asyncio.Queue[dict[str, Any]]] = field(default_factory=set)
    task: asyncio.Task[None] | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def info(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "source": self.source,
            "state": self.state,
            "error": self.error,
            "subscribers": len(self.subscribers),
            "createdAt": round(self.created_at),
        }


Runner = Callable[[Callable[[], list[protocol.Event]]], Awaitable[list[protocol.Event]]]


class SessionHub:
    def __init__(
        self,
        engine: Engine,
        vad: Vad,
        run: Runner,
        options: StreamingOptions | None = None,
        max_sessions: int = 4,
        ffmpeg: str = "ffmpeg",
    ) -> None:
        self._engine = engine
        self._vad = vad
        self._run = run
        self._options = options
        self._max_sessions = max_sessions
        self._ffmpeg = ffmpeg
        self.sessions: dict[str, Session] = {}

    def create(
        self,
        source: SourceType,
        url: str | None = None,
        realtime: bool = False,
        session_id: str | None = None,
    ) -> Session:
        """Cria uma sessão. Com `session_id` já em uso, apague a antiga antes (`delete`)."""
        self.reap()
        if session_id is not None and not SESSION_ID.fullmatch(session_id):
            raise SessionError("Id de sessão inválido: use de 16 a 64 letras, números, - ou _")
        if session_id in self.sessions:
            raise SessionError("Já existe uma sessão com esse id")
        if len(self.sessions) >= self._max_sessions:
            raise SessionError("Limite de sessões simultâneas atingido")
        if source == "url":
            check_stream_url(url or "")
        elif source != "audio":
            raise SessionError("Fonte desconhecida: use 'audio' ou 'url'")
        session = Session(
            id=session_id or secrets.token_urlsafe(16),
            source=source,
            url=url if source == "url" else None,
            streaming=StreamingSession(self._engine, self._vad, self._options),
        )
        self.sessions[session.id] = session
        if source == "url":
            session.task = asyncio.create_task(self._ingest_url(session, realtime))
        log.info("Sessão %s criada (%s)", session.id, source)
        return session

    def get(self, session_id: str) -> Session | None:
        return self.sessions.get(session_id)

    async def delete(self, session_id: str) -> bool:
        session = self.sessions.pop(session_id, None)
        if not session:
            return False
        if session.task:
            session.task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await session.task
        self._set_state(session, "ended")
        return True

    def reap(self) -> None:
        """Remove sessões de áudio paradas há muito tempo (o Estúdio foi fechado sem encerrar)."""
        now = time.time()
        for session in list(self.sessions.values()):
            idle = now - session.last_activity > IDLE_SECONDS
            if idle and not session.ingest_connected and not session.task:
                self.sessions.pop(session.id, None)
                # Os overlays fecham a conexão e esperam uma sessão nova com o mesmo id.
                self._set_state(session, "ended")

    # Assinantes -----------------------------------------------------------

    def subscribe(self, session: Session) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=200)
        session.subscribers.add(queue)
        session.last_activity = time.time()
        return queue

    def unsubscribe(self, session: Session, queue: asyncio.Queue[dict[str, Any]]) -> None:
        session.subscribers.discard(queue)

    def publish(self, session: Session, message: dict[str, Any]) -> None:
        for queue in list(session.subscribers):
            # Assinante lento perde mensagens antigas em vez de travar a sessão.
            if queue.full():
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()
            queue.put_nowait(message)

    def _set_state(self, session: Session, state: SessionState, error: str | None = None) -> None:
        session.state = state
        session.error = error
        self.publish(session, {"type": "state", "state": state, "error": error})

    # Áudio -----------------------------------------------------------------

    async def feed(self, session: Session, pcm16: bytes) -> list[protocol.Event]:
        """Acrescenta áudio, roda um passo se for a hora e publica os eventos."""
        session.last_activity = time.time()
        if session.state == "waiting":
            self._set_state(session, "live")
        async with session.lock:
            session.streaming.append(pcm16)
            if not session.streaming.should_step():
                return []
            events = await self._run(session.streaming.step)
        for event in events:
            self.publish(session, event.to_json())
        return events

    async def flush(self, session: Session) -> list[protocol.Event]:
        async with session.lock:
            events = await self._run(session.streaming.flush)
        for event in events:
            self.publish(session, event.to_json())
        return events

    async def _ingest_url(self, session: Session, realtime: bool) -> None:
        args = [
            self._ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-protocol_whitelist",
            FFMPEG_PROTOCOLS,
            # Vídeo gravado: lê na velocidade real, como se fosse ao vivo.
            *(["-re"] if realtime else []),
            "-i",
            session.url or "",
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(protocol.SAMPLE_RATE),
            "-f",
            "s16le",
            "pipe:1",
        ]
        try:
            process = await asyncio.create_subprocess_exec(
                *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )
        except FileNotFoundError:
            self._set_state(session, "error", "ffmpeg não está instalado no servidor")
            return
        assert process.stdout and process.stderr
        try:
            while chunk := await _read_chunk(process.stdout, CHUNK_BYTES):
                await self.feed(session, chunk)
            await self.flush(session)
            await process.wait()
            if process.returncode == 0:
                self._set_state(session, "ended")
            else:
                detail = (await process.stderr.read()).decode(errors="replace").strip()
                message = (
                    detail.splitlines()[-1] if detail else f"ffmpeg saiu com {process.returncode}"
                )
                self._set_state(session, "error", message)
        except asyncio.CancelledError:
            process.kill()
            raise
        finally:
            session.task = None


async def _read_chunk(stream: asyncio.StreamReader, size: int) -> bytes:
    """Lê `size` bytes ou o que restar até o fim do fluxo."""
    try:
        return await stream.readexactly(size)
    except asyncio.IncompleteReadError as partial:
        return partial.partial
