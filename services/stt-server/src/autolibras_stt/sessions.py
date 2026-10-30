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
import math
import re
import secrets
import time
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal
from urllib.parse import urlparse

from . import protocol
from .captions import CaptionError, follow_embedded_captions, follow_hls_captions
from .composer import CompositionError, CompositionOptions, Compositor, window_page_url
from .engine import Engine
from .feedback import feedback_key
from .streaming import StreamingOptions, StreamingSession
from .vad import Vad

log = logging.getLogger("autolibras_stt.sessions")

SourceType = Literal["audio", "url", "text", "rtmp"]
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


class AudioClock:
    """Liga a posição no áudio da sessão (segundos) ao relógio do servidor.

    Cada bloco chega depois de ter sido capturado, então `chegada - posição` é um
    limite superior para o instante em que o áudio começou. O menor valor numa
    janela recente é a melhor estimativa; a janela deixa o relógio se corrigir
    quando o envio para (rede caiu, aba suspensa) e o áudio perdido some.
    """

    def __init__(self, window_s: float = 10.0, now: Callable[[], float] = time.time) -> None:
        self._window = window_s
        self._now = now
        self._samples: deque[tuple[float, float]] = deque()

    def observe(self, position_s: float) -> None:
        """Registra que o áudio até `position_s` acabou de chegar."""
        now = self._now()
        self._samples.append((now, now - position_s))
        while self._samples and now - self._samples[0][0] > self._window:
            self._samples.popleft()

    def wall(self, position_s: float) -> float | None:
        """Horário (epoch, relógio do servidor) em que o áudio em `position_s` foi capturado."""
        if not self._samples:
            return None
        return min(origin for _, origin in self._samples) + position_s


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(fraction * len(ordered)) - 1))
    return ordered[index]


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
    # Sessão por endereço que lê a legenda WebVTT do HLS em vez do áudio.
    captions: bool = False
    # Fonte "rtmp": chave que o OBS usa para enviar a transmissão (segredo).
    stream_key: str | None = None
    composition: CompositionOptions | None = None
    compositor: Compositor | None = None
    ingest_connected: bool = False
    subscribers: set[asyncio.Queue[dict[str, Any]]] = field(default_factory=set)
    task: asyncio.Task[None] | None = None
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    clock: AudioClock = field(default_factory=AudioClock)
    samples: int = 0
    text_segment: int = 1
    # Segundos entre o início de cada frase na fala e o envio do final, das últimas frases.
    latencies: deque[float] = field(default_factory=lambda: deque(maxlen=50))

    def info(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "source": self.source,
            "state": self.state,
            "error": self.error,
            "subscribers": len(self.subscribers),
            "captions": self.captions,
            "composition": self.composition_info(),
            "feedbackKey": feedback_key(self.id),
            "createdAt": round(self.created_at),
            "latency": self.latency(),
        }

    def composition_info(self) -> dict[str, Any] | None:
        if not self.composition:
            return None
        compositor = self.compositor
        return {
            **self.composition.public(),
            "state": compositor.state if compositor else "starting",
            "frames": compositor.frames if compositor else 0,
        }

    def latency(self) -> dict[str, float] | None:
        """Quanto cada frase leva, do começo da fala até o final sair do servidor.

        `recommendedDelay` é o atraso sugerido para o modo sincronizado: cobre 95%
        das frases e mais 1 s para a tradução em glosa.
        """
        if not self.latencies:
            return None
        values = list(self.latencies)
        p95 = percentile(values, 0.95)
        return {
            "p50": round(percentile(values, 0.5), 2),
            "p95": round(p95, 2),
            "recommendedDelay": math.ceil(p95 + 1),
            "count": len(values),
        }


Runner = Callable[[Callable[[], list[protocol.Event]]], Awaitable[list[protocol.Event]]]


@dataclass(frozen=True)
class ComposerConfig:
    """O que a composição precisa do servidor: onde a página do overlay está, o
    pacote de sinais, o Chromium e a porta RTMP. `unavailable` diz por que ela não
    funciona aqui (None: funciona)."""

    page_base: str = ""
    signs_url: str = ""
    chromium: str = ""
    rtmp_port: int = 1935
    unavailable: str | None = "composição não configurada"


class SessionHub:
    def __init__(
        self,
        engine: Engine,
        vad: Vad,
        run: Runner,
        options: StreamingOptions | None = None,
        max_sessions: int = 4,
        ffmpeg: str = "ffmpeg",
        composer: ComposerConfig | None = None,
    ) -> None:
        self._engine = engine
        self._vad = vad
        self._run = run
        self._options = options
        self._max_sessions = max_sessions
        self._ffmpeg = ffmpeg
        self.composer = composer or ComposerConfig()
        self.sessions: dict[str, Session] = {}

    def create(
        self,
        source: SourceType,
        url: str | None = None,
        realtime: bool = False,
        session_id: str | None = None,
        captions: bool = False,
        composition: CompositionOptions | None = None,
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
        elif source not in ("audio", "text", "rtmp"):
            raise SessionError("Fonte desconhecida: use 'audio', 'url', 'text' ou 'rtmp'")
        if composition:
            if source not in ("url", "rtmp"):
                raise SessionError("A composição precisa de uma fonte 'url' ou 'rtmp'")
            if self.composer.unavailable:
                raise SessionError(f"Composição indisponível: {self.composer.unavailable}")
            try:
                composition.validate()
            except CompositionError as error:
                raise SessionError(str(error)) from error
            if any(s.composition and s.task for s in self.sessions.values()):
                raise SessionError("Já há uma composição em andamento neste servidor")
        if source == "rtmp" and any(s.source == "rtmp" and s.task for s in self.sessions.values()):
            raise SessionError("Já há uma sessão recebendo RTMP neste servidor")
        stream_key = secrets.token_urlsafe(12) if source == "rtmp" else None
        session = Session(
            id=session_id or secrets.token_urlsafe(16),
            source=source,
            url=(
                url
                if source == "url"
                else f"rtmp://0.0.0.0:{self.composer.rtmp_port}/live/{stream_key}"
                if source == "rtmp"
                else None
            ),
            streaming=StreamingSession(self._engine, self._vad, self._options),
            captions=captions and source == "url" and not composition,
            stream_key=stream_key,
            composition=composition,
        )
        self.sessions[session.id] = session
        if composition:
            session.task = asyncio.create_task(self._compose(session, realtime))
        elif source == "rtmp":
            session.task = asyncio.create_task(self._ingest_url(session, False, listen=True))
        elif source == "url" and session.captions:
            session.task = asyncio.create_task(self._ingest_captions(session, realtime))
        elif source == "url":
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

    async def feed(self, session: Session, pcm16: bytes) -> list[dict[str, Any]]:
        """Acrescenta áudio, roda um passo se for a hora e publica os eventos."""
        session.last_activity = time.time()
        if session.state == "waiting":
            self._set_state(session, "live")
        session.samples += len(pcm16) // 2
        session.clock.observe(session.samples / protocol.SAMPLE_RATE)
        async with session.lock:
            session.streaming.append(pcm16)
            if not session.streaming.should_step():
                return []
            events = await self._run(session.streaming.step)
        return self._publish_events(session, events)

    async def flush(self, session: Session) -> list[dict[str, Any]]:
        async with session.lock:
            events = await self._run(session.streaming.flush)
        return self._publish_events(session, events)

    def _publish_events(
        self, session: Session, events: list[protocol.Event]
    ) -> list[dict[str, Any]]:
        messages = []
        for event in events:
            message = event.to_json()
            if isinstance(event, protocol.Final):
                message |= self._timing(session, event.start, event.end, bool(event.text))
            self.publish(session, message)
            messages.append(message)
        return messages

    def _timing(
        self, session: Session, start: float | None, end: float | None, measure: bool
    ) -> dict[str, Any]:
        """Horários da frase no relógio do servidor, para o modo sincronizado."""
        now = time.time()
        wall_start = session.clock.wall(start) if start is not None else now
        wall_end = session.clock.wall(end) if end is not None else now
        timing: dict[str, Any] = {"serverTime": round(now, 3)}
        if wall_start is not None and wall_end is not None:
            timing |= {"wallStart": round(wall_start, 3), "wallEnd": round(wall_end, 3)}
            if measure:
                session.latencies.append(max(0.0, now - wall_start))
        return timing

    def text(self, session: Session, text: str, final: bool = True) -> dict[str, Any] | None:
        """Publica um texto pronto (legenda, estenotipia, digitação) como frase da sessão.

        Parciais (`final=False`) só atualizam a legenda; o final vai para o avatar.
        """
        session.last_activity = time.time()
        if session.state == "waiting":
            self._set_state(session, "live")
        text = " ".join(text.split())
        segment_id = f"t{session.text_segment}"
        if not final:
            if not text:
                return None
            message: dict[str, Any] = {
                "type": "partial",
                "id": segment_id,
                "text": text,
                "stable": "",
            }
        else:
            session.text_segment += 1
            message = {"type": "final", "id": segment_id, "text": text, "start": None, "end": None}
            message |= self._timing(session, None, None, False)
        self.publish(session, message)
        return message

    async def _ingest_captions(self, session: Session, realtime: bool) -> None:
        async def emit(text: str, final: bool) -> None:
            self.text(session, text, final)

        url = session.url or ""
        try:
            try:
                if ".m3u8" not in url:
                    raise CaptionError("não é HLS")
                await follow_hls_captions(url, emit, realtime=realtime)
            except CaptionError:
                # Sem faixa WebVTT: tenta o closed caption embutido no vídeo.
                await follow_embedded_captions(
                    url, emit, ffmpeg=self._ffmpeg, protocols=FFMPEG_PROTOCOLS, realtime=realtime
                )
            self._set_state(session, "ended")
        except asyncio.CancelledError:
            raise
        except CaptionError as error:
            self._set_state(session, "error", str(error))
        except Exception as error:  # rede, HTTP, playlist malformada
            log.warning("Legendas da sessão %s: %s", session.id, error)
            self._set_state(session, "error", f"Não foi possível ler as legendas: {error}")
        finally:
            session.task = None

    async def _compose(self, session: Session, realtime: bool) -> None:
        assert session.composition
        config = self.composer
        compositor = Compositor(
            source=session.url or "",
            realtime=realtime,
            options=session.composition,
            listen=session.source == "rtmp",
            page_url=window_page_url(
                config.page_base, session.id, session.composition, config.signs_url
            ),
            feed=lambda pcm: self.feed(session, pcm),
            media_start=lambda: session.clock.wall(0.0),
            ffmpeg=self._ffmpeg,
            chromium=config.chromium,
            protocols=FFMPEG_PROTOCOLS,
        )
        session.compositor = compositor
        try:
            await compositor.run()
            await self.flush(session)
            self._set_state(session, "ended")
        except asyncio.CancelledError:
            raise
        except Exception as error:  # ffmpeg, Chromium, rede
            log.warning("Composição da sessão %s: %s", session.id, error)
            self._set_state(session, "error", f"Composição: {error}")
        finally:
            session.task = None

    async def _ingest_url(self, session: Session, realtime: bool, listen: bool = False) -> None:
        args = [
            self._ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            # Fonte "rtmp": espera o OBS enviar, em vez de abrir um endereço.
            *(["-listen", "1"] if listen else ["-protocol_whitelist", FFMPEG_PROTOCOLS]),
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
