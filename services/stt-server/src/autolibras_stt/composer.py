"""Composição no servidor: a transmissão sai com a janela de Libras embutida.

```text
OBS ──RTMP──► ffmpeg (entrada) ─┬─ áudio PCM ─► sessão (Whisper) ─► frases com horário
 (ou endereço)                  │                                         │
                                └─ MPEG-TS ─► atraso de D s ─┐            ▼
                                                             │   overlay no Chromium sem tela,
                                                             │   modo sincronizado (atraso=D)
                                                             ▼            │ quadros JPEG
                                                 ffmpeg (composição) ◄────┘
                                                             │
                                                             └──► RTMP/SRT (YouTube, Twitch)
```

O vídeo do programa fica D segundos para trás ainda comprimido, então o atraso
custa poucos megabytes. O overlay sinaliza cada frase D segundos depois de ela
ter sido dita, e por isso o sinal sai junto com a fala no vídeo atrasado.

A janela é desenhada pela mesma página `broadcast.html` do OBS, num Chromium sem
tela. Por padrão ela tem fundo próprio (um painel, como a janela de intérprete
da TV); com `background="recorte"`, o fundo verde é recortado e só o avatar
fica sobre o vídeo.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import logging
import os
import re
import shutil
import time
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlencode, urlparse

from . import protocol

log = logging.getLogger("autolibras_stt.composer")

OUTPUT_SCHEMES = {"rtmp", "rtmps", "srt"}
PANEL_COLOR = "#e9eef3"
CHROMA_COLOR = "#00ff00"
RESOLUTION = re.compile(r"(\d{3,4})x(\d{3,4})")
TS_CHUNK = 64 * 1024
WINDOW_FPS = 30
# Quanto a janela pode acumular enquanto o ffmpeg ainda analisa a entrada.
MAX_PENDING_FRAMES = 64 * 2**20
# WebGL por software (SwiftShader): o servidor costuma não ter GPU para o Chromium.
CHROMIUM_ARGS = [
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--autoplay-policy=no-user-gesture-required",
]


class CompositionError(Exception):
    """Pedido de composição inválido, ou faltam ffmpeg, Chromium ou Playwright."""


@dataclass(frozen=True)
class CompositionOptions:
    """Como a janela de Libras entra no vídeo de saída."""

    # Para onde vai a transmissão pronta: rtmp://, rtmps:// ou srt:// (com a chave).
    output: str
    # Atraso do programa, em segundos: o tempo que a fala leva para virar sinal.
    delay: float = 8.0
    position: Literal["right", "left"] = "right"
    # Altura da janela, como fração da altura do vídeo.
    size: float = 0.5
    background: Literal["painel", "recorte"] = "painel"
    caption: bool = True
    resolution: str = "1280x720"
    video_bitrate: str = "4500k"

    def validate(self) -> None:
        parsed = urlparse(self.output)
        if parsed.scheme not in OUTPUT_SCHEMES or not parsed.netloc:
            raise CompositionError("A saída precisa ser um endereço rtmp://, rtmps:// ou srt://")
        if not 2 <= self.delay <= 30:
            raise CompositionError("O atraso precisa ficar entre 2 e 30 segundos")
        if not 0.2 <= self.size <= 0.8:
            raise CompositionError("A janela precisa ter entre 20% e 80% da altura do vídeo")
        if not RESOLUTION.fullmatch(self.resolution):
            raise CompositionError("Use uma resolução como 1280x720 ou 1920x1080")

    @property
    def frame(self) -> tuple[int, int]:
        match = RESOLUTION.fullmatch(self.resolution)
        assert match
        return int(match.group(1)), int(match.group(2))

    def window(self) -> tuple[int, int, int, int]:
        """Largura, altura e posição (x, y) da janela, em pixels pares, no vídeo de saída."""
        width, height = self.frame
        h = round(height * self.size / 2) * 2
        w = round(h * 3 / 4 / 2) * 2
        margin = round(height * 0.03 / 2) * 2
        x = margin if self.position == "left" else width - w - margin
        return w, h, x, height - h - margin

    def public(self) -> dict[str, Any]:
        """Para mostrar na API, sem a chave de transmissão do endereço de saída."""
        parsed = urlparse(self.output)
        return {
            "output": f"{parsed.scheme}://{parsed.netloc}/…",
            "delay": self.delay,
            "position": self.position,
            "size": self.size,
            "background": self.background,
            "caption": self.caption,
            "resolution": self.resolution,
        }


def input_args(
    ffmpeg: str, source: str, protocols: str, realtime: bool, pcm_fd: int, listen: bool = False
) -> list[str]:
    """ffmpeg que lê a transmissão e a divide em programa (MPEG-TS) e áudio (PCM).

    Com `listen`, o ffmpeg espera o OBS enviar por RTMP no endereço `source`; a chave
    no fim do endereço precisa bater com a que o OBS usa.
    """
    return [
        ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        *(["-listen", "1"] if listen else ["-protocol_whitelist", protocols]),
        *(["-re"] if realtime else []),
        "-i",
        source,
        # Programa: vídeo e áudio como vieram, sem recodificar. Sem buffer na saída:
        # o programa tem de chegar junto com o áudio do reconhecimento, ou a janela
        # sai adiantada em relação à fala.
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-c",
        "copy",
        "-flush_packets",
        "1",
        "-muxdelay",
        "0",
        "-muxpreload",
        "0",
        "-f",
        "mpegts",
        "pipe:1",
        # Áudio para o reconhecimento de fala.
        "-map",
        "0:a:0",
        "-ac",
        "1",
        "-ar",
        str(protocol.SAMPLE_RATE),
        "-flush_packets",
        "1",
        "-f",
        "s16le",
        f"pipe:{pcm_fd}",
    ]


def compose_args(ffmpeg: str, options: CompositionOptions, frames_fd: int) -> list[str]:
    """ffmpeg que junta o programa atrasado (stdin) e os quadros da janela (outro pipe)."""
    width, height = options.frame
    w, h, x, y = options.window()
    window = f"[1:v]setpts=PTS-STARTPTS,scale={w}:{h}"
    if options.background == "recorte":
        window += f",colorkey=0x{CHROMA_COLOR[1:]}:0.35:0.08"
    graph = ";".join(
        [
            f"[0:v]setpts=PTS-STARTPTS,scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1[programa]",
            f"{window}[janela]",
            f"[programa][janela]overlay={x}:{y}:eof_action=pass:repeatlast=1,fps=30,format=yuv420p[v]",
            "[0:a]asetpts=PTS-STARTPTS[a]",
        ]
    )
    output_format = "mpegts" if options.output.startswith("srt://") else "flv"
    return [
        ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-thread_queue_size",
        "1024",
        "-f",
        "mpegts",
        "-i",
        "pipe:0",
        # A janela chega a 30 quadros por segundo exatos (ver `Compositor`), então o
        # tempo de cada quadro sai da contagem, não da hora em que o ffmpeg o lê.
        "-thread_queue_size",
        "1024",
        "-framerate",
        str(WINDOW_FPS),
        "-f",
        "image2pipe",
        "-c:v",
        "mjpeg",
        "-i",
        f"pipe:{frames_fd}",
        "-filter_complex",
        graph,
        "-map",
        "[v]",
        "-map",
        "[a]",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "zerolatency",
        "-b:v",
        options.video_bitrate,
        "-maxrate",
        options.video_bitrate,
        "-bufsize",
        str(int(options.video_bitrate.rstrip("k")) * 2) + "k",
        "-g",
        "60",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-ar",
        "48000",
        "-f",
        output_format,
        options.output,
    ]


def window_page_url(base: str, session_id: str, options: CompositionOptions, signs_url: str) -> str:
    """Endereço do overlay que desenha a janela: avatar próprio no modo sincronizado."""
    query = {
        "session": session_id,
        "avatar": "propio",
        "signs": signs_url,
        "atraso": f"{options.delay:g}",
        "bg": CHROMA_COLOR if options.background == "recorte" else PANEL_COLOR,
    }
    if options.caption:
        query["legenda"] = "1"
    return f"{base.rstrip('/')}/broadcast.html?{urlencode(query)}"


class DelayBuffer:
    """Guarda bytes e os devolve `delay` segundos depois de terem chegado."""

    def __init__(self, delay: float, now: Callable[[], float] = time.monotonic) -> None:
        self._delay = delay
        self._now = now
        self._items: deque[tuple[float, bytes]] = deque()
        self._size = 0

    @property
    def size(self) -> int:
        return self._size

    def push(self, data: bytes) -> None:
        self._items.append((self._now(), data))
        self._size += len(data)

    def due(self) -> tuple[bytes, float | None]:
        """Os bytes já vencidos, e quantos segundos faltam para o próximo (ou None)."""
        now = self._now()
        out = []
        while self._items and now - self._items[0][0] >= self._delay:
            _, data = self._items.popleft()
            self._size -= len(data)
            out.append(data)
        wait = self._items[0][0] + self._delay - now if self._items else None
        return b"".join(out), wait


def find_chromium(configured: str = "") -> str | None:
    if configured:
        return configured if os.path.exists(configured) or shutil.which(configured) else None
    for name in ("chromium", "chromium-browser", "google-chrome"):
        path = shutil.which(name)
        if path:
            return path
    return None


def playwright_browser_installed() -> bool:
    """Há o Chromium baixado pelo Playwright (`playwright install chromium`), das imagens Docker."""
    root = os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or os.path.expanduser(
        "~/.cache/ms-playwright"
    )
    return os.path.isdir(root) and any(name.startswith("chromium") for name in os.listdir(root))


def composition_available(ffmpeg: str, chromium: str) -> str | None:
    """Motivo pelo qual a composição não funciona neste servidor, ou None se funciona."""
    if not shutil.which(ffmpeg) and not os.path.exists(ffmpeg):
        return "ffmpeg não está instalado no servidor"
    try:
        import playwright  # noqa: F401
    except ImportError:
        return "Falta o pacote playwright (pip install 'autolibras-stt[composicao]')"
    if not find_chromium(chromium) and not playwright_browser_installed():
        return "Chromium não está instalado no servidor (python -m playwright install chromium)"
    return None


async def check_webgl(chromium: str = "") -> bool:
    """Abre o Chromium sem tela e confere se o WebGL 2, que o avatar usa, funciona."""
    from playwright.async_api import async_playwright

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=find_chromium(chromium), args=CHROMIUM_ARGS
        )
        try:
            page = await browser.new_page()
            return bool(
                await page.evaluate("!!document.createElement('canvas').getContext('webgl2')")
            )
        finally:
            await browser.close()


def main() -> None:
    """`python -m autolibras_stt.composer --check`: diz se a composição funciona aqui."""
    import sys

    problem = composition_available("ffmpeg", os.environ.get("AUTOLIBRAS_CHROMIUM", ""))
    if problem:
        print(f"Composição indisponível: {problem}")
        sys.exit(1)
    if not asyncio.run(check_webgl(os.environ.get("AUTOLIBRAS_CHROMIUM", ""))):
        print("Composição indisponível: o Chromium não tem WebGL 2")
        sys.exit(1)
    print("Composição disponível: ffmpeg, Playwright, Chromium e WebGL 2 funcionando")


if __name__ == "__main__":
    main()


Feed = Callable[[bytes], Awaitable[Any]]


class Compositor:
    """Uma composição em andamento. `run()` só termina quando a entrada acaba ou falha."""

    def __init__(
        self,
        *,
        source: str,
        realtime: bool,
        options: CompositionOptions,
        listen: bool = False,
        page_url: str,
        feed: Feed,
        media_start: Callable[[], float | None] = lambda: None,
        ffmpeg: str = "ffmpeg",
        chromium: str = "",
        protocols: str = "",
    ) -> None:
        self.options = options
        self._source = source
        self._realtime = realtime
        self._listen = listen
        self._page_url = page_url
        self._feed = feed
        # Horário (time.time) em que o começo da mídia foi capturado, pelo relógio do
        # áudio da sessão: o mesmo que marca as frases que o overlay sinaliza.
        self._media_start = media_start
        self._ffmpeg = ffmpeg
        # Sem Chromium do sistema, o Playwright usa o que ele mesmo baixou.
        self._chromium = find_chromium(chromium)
        self._protocols = protocols
        self.state = "starting"
        self.frames = 0

    async def run(self) -> None:
        from playwright.async_api import async_playwright

        pcm_read, pcm_write = os.pipe()
        frames_read, frames_write = os.pipe()
        # Descritores ainda abertos por este processo; cada um é fechado uma vez só,
        # porque o número de um descritor fechado pode passar a ser de outro arquivo.
        open_fds = {frames_read, frames_write}

        def close_fd(fd: int) -> None:
            if fd in open_fds:
                open_fds.discard(fd)
                os.close(fd)

        source = await asyncio.create_subprocess_exec(
            *input_args(
                self._ffmpeg, self._source, self._protocols, self._realtime, pcm_write, self._listen
            ),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            pass_fds=(pcm_write,),
        )
        os.close(pcm_write)
        log.info("Composição: lendo %s", "RTMP do OBS" if self._listen else self._source)
        compose: asyncio.subprocess.Process | None = None
        started = asyncio.Event()
        buffer = DelayBuffer(self.options.delay)
        tasks: list[asyncio.Task[Any]] = []
        loop = asyncio.get_running_loop()

        async def read_pcm() -> None:
            reader = asyncio.StreamReader()
            transport, _ = await loop.connect_read_pipe(
                lambda: asyncio.StreamReaderProtocol(reader), os.fdopen(pcm_read, "rb", 0)
            )
            try:
                chunk_bytes = protocol.SAMPLE_RATE * 2 // 10
                while data := await reader.read(chunk_bytes):
                    await self._feed(data)
            finally:
                transport.close()

        async def read_program() -> None:
            assert source.stdout
            first = True
            while data := await source.stdout.read(TS_CHUNK):
                if first:
                    log.info("Composição: programa chegando; atraso de %gs", self.options.delay)
                    first = False
                buffer.push(data)

        async def write_program() -> None:
            nonlocal compose
            while True:
                data, wait = buffer.due()
                if data:
                    if compose is None:
                        compose = await asyncio.create_subprocess_exec(
                            *compose_args(self._ffmpeg, self.options, frames_read),
                            stdin=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE,
                            pass_fds=(frames_read,),
                        )
                        close_fd(frames_read)
                        self.state = "live"
                        log.info("Composição: enviando para %s", self.options.public()["output"])
                        started.set()
                    assert compose.stdin
                    compose.stdin.write(data)
                    await compose.stdin.drain()
                elif source.returncode is not None and wait is None:
                    return
                await asyncio.sleep(min(wait, 0.05) if wait else 0.02)

        async def render() -> None:
            open_fds.discard(frames_write)  # agora é do `frames`, que o fecha
            frames, _ = await loop.connect_write_pipe(
                asyncio.Protocol, os.fdopen(frames_write, "wb", buffering=0)
            )
            width, height = self.options.window()[:2]
            async with async_playwright() as playwright:
                browser = await playwright.chromium.launch(
                    executable_path=self._chromium, args=CHROMIUM_ARGS
                )
                try:
                    page = await browser.new_page(viewport={"width": width, "height": height})
                    await page.goto(self._page_url)
                    log.info("Composição: janela de Libras carregada (%dx%d)", width, height)
                    cdp = await page.context.new_cdp_session(page)
                    latest: list[bytes] = []

                    async def on_frame(event: dict[str, Any]) -> None:
                        latest[:] = [base64.b64decode(event["data"])]
                        # O navegador pode fechar com uma confirmação ainda pendente.
                        with contextlib.suppress(Exception):
                            await cdp.send(
                                "Page.screencastFrameAck", {"sessionId": event["sessionId"]}
                            )

                    cdp.on("Page.screencastFrame", lambda e: asyncio.ensure_future(on_frame(e)))
                    await cdp.send(
                        "Page.startScreencast",
                        {"format": "jpeg", "quality": 85, "everyNthFrame": 1},
                    )
                    await started.wait()
                    # A janela sai a 30 quadros por segundo exatos, contados a partir do
                    # primeiro byte do programa atrasado: assim os dois começam no mesmo
                    # instante, mesmo que o ffmpeg demore para abrir as entradas.
                    # A página carrega bem antes de o atraso passar, então quase sempre
                    # já há um quadro aqui.
                    while not latest:
                        await asyncio.sleep(0.01)
                    # O quadro 0 da janela corresponde ao instante 0 da mídia mais o
                    # atraso, o mesmo relógio que o overlay usa para sinalizar cada frase.
                    # Se esse instante já passou (a entrada chega em rajada no começo),
                    # os quadros que faltam saem repetidos de uma vez.
                    media_start = self._media_start()
                    origin = loop.time()
                    if media_start is not None:
                        origin += media_start + self.options.delay - time.time()
                    while origin + self.frames / WINDOW_FPS < loop.time() - 1 / WINDOW_FPS:
                        frames.write(latest[0])
                        self.frames += 1
                    while True:
                        if frames.is_closing():
                            return
                        if frames.get_write_buffer_size() > MAX_PENDING_FRAMES:
                            raise CompositionError("o ffmpeg parou de ler a janela de Libras")
                        frames.write(latest[0])
                        self.frames += 1
                        next_at = origin + self.frames / WINDOW_FPS
                        await asyncio.sleep(max(0.0, next_at - loop.time()))
                finally:
                    with contextlib.suppress(Exception):
                        frames.close()
                    await browser.close()

        try:
            tasks = [
                asyncio.create_task(read_pcm()),
                asyncio.create_task(read_program()),
                asyncio.create_task(render()),
            ]
            writer = asyncio.create_task(write_program())
            await writer
            await source.wait()
            if source.returncode not in (0, None):
                detail = (
                    (await source.stderr.read()).decode(errors="replace").strip()
                    if source.stderr
                    else ""
                )
                raise CompositionError(detail.splitlines()[-1] if detail else "a entrada falhou")
            if compose and compose.stdin:
                compose.stdin.close()
                await compose.wait()
                if compose.returncode:
                    detail = (
                        (await compose.stderr.read()).decode(errors="replace").strip()
                        if compose.stderr
                        else ""
                    )
                    raise CompositionError(
                        detail.splitlines()[-1] if detail else "a composição falhou"
                    )
            self.state = "ended"
        finally:
            for task in tasks:
                task.cancel()
            for task in tasks:
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
            for process in (source, compose):
                if process and process.returncode is None:
                    process.kill()
                    with contextlib.suppress(Exception):
                        await process.wait()
            for fd in list(open_fds):
                close_fd(fd)
