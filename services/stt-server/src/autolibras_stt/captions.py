"""Legendas da transmissão como fonte de texto.

Quando a transmissão já tem legenda (feita por estenotipista ou revisada), ela é
melhor que o reconhecimento de fala. Há dois tipos:
- WebVTT em HLS: o módulo acha a faixa de legendas na playlist mestre
  (`#EXT-X-MEDIA:TYPE=SUBTITLES`, de preferência em português) e acompanha os
  segmentos `.vtt` novos;
- closed caption embutido no vídeo (CEA-608, o da TV aberta): o ffmpeg extrai
  as legendas do vídeo, em qualquer endereço que ele leia (RTMP, SRT, HLS, TS).

Legendas ao vivo costumam vir em rolagem: cada deixa repete o fim da anterior e
acrescenta palavras. `CaptionAssembler` tira a repetição e só solta uma frase
quando ela termina em `.`, `?` ou `!`, ou quando passa do tamanho máximo.
"""

from __future__ import annotations

import asyncio
import re
import urllib.request
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from urllib.parse import urljoin

MAX_BYTES = 2 * 1024 * 1024
SENTENCE_END = re.compile(r"[.?!…]['\")\]]*$")
TAG = re.compile(r"<[^>]*>|\{\\[^}]*\}")
# Descrições de som, como "(música)" e "[aplausos]", e marcas de troca de falante.
NON_SPEECH = re.compile(r"\([^)]*\)|\[[^\]]*\]|>>+|♪+")
TIME = re.compile(r"(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})")


class CaptionError(Exception):
    """A transmissão não tem legendas que o servidor consiga ler."""


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    text: str


def fetch_text(url: str, timeout: float = 10.0) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "AutoLibras"})
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
        return response.read(MAX_BYTES).decode("utf-8", errors="replace")


def _attributes(line: str) -> dict[str, str]:
    pairs = re.findall(r'([A-Z0-9-]+)=("[^"]*"|[^,]*)', line.split(":", 1)[-1])
    return {key: value.strip('"') for key, value in pairs}


def subtitle_playlist(master: str, base_url: str, language: str = "pt") -> str | None:
    """URL da faixa de legendas da playlist mestre, de preferência no idioma pedido.

    Se `master` já for a playlist de mídia das legendas, devolve a própria URL.
    """
    if "#EXTINF" in master and ".vtt" in master:
        return base_url
    tracks = [
        _attributes(line)
        for line in master.splitlines()
        if line.startswith("#EXT-X-MEDIA:") and "TYPE=SUBTITLES" in line
    ]
    tracks = [track for track in tracks if track.get("URI")]
    if not tracks:
        return None
    preferred = [t for t in tracks if t.get("LANGUAGE", "").lower().startswith(language)]
    return urljoin(base_url, (preferred or tracks)[0]["URI"])


@dataclass(frozen=True)
class MediaPlaylist:
    sequence: int
    segments: list[str]
    target_duration: float
    ended: bool


def parse_media_playlist(text: str, base_url: str) -> MediaPlaylist:
    sequence = 0
    target = 6.0
    segments: list[str] = []
    expect_uri = False
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("#EXT-X-MEDIA-SEQUENCE:"):
            sequence = int(line.split(":", 1)[1] or 0)
        elif line.startswith("#EXT-X-TARGETDURATION:"):
            target = float(line.split(":", 1)[1] or 6)
        elif line.startswith("#EXTINF"):
            expect_uri = True
        elif line and not line.startswith("#") and expect_uri:
            segments.append(urljoin(base_url, line))
            expect_uri = False
    return MediaPlaylist(sequence, segments, target, "#EXT-X-ENDLIST" in text)


def _seconds(match: re.Match[str]) -> float:
    hours, minutes, seconds, millis = match.groups()
    return int(hours or 0) * 3600 + int(minutes) * 60 + int(seconds) + int(millis) / 1000


def parse_vtt(text: str) -> list[Cue]:
    cues: list[Cue] = []
    for block in re.split(r"\r?\n\r?\n", text):
        lines = [line.strip() for line in block.strip().splitlines()]
        timing = next((i for i, line in enumerate(lines) if "-->" in line), None)
        if timing is None:
            continue
        times = [_seconds(match) for match in TIME.finditer(lines[timing])]
        if len(times) < 2:
            continue
        start, end = times[:2]
        body = " ".join(TAG.sub("", line) for line in lines[timing + 1 :] if line)
        body = " ".join(NON_SPEECH.sub(" ", body).split())
        if body:
            cues.append(Cue(start, end, body))
    return cues


def _key(word: str) -> str:
    return re.sub(r"[^\w]", "", word.lower())


@dataclass
class CaptionAssembler:
    """Junta deixas de legenda em frases, sem as repetições da rolagem."""

    max_words: int = 30
    _recent: list[str] = field(default_factory=list)
    _pending: list[str] = field(default_factory=list)

    def push(self, text: str) -> list[str]:
        """Recebe a próxima deixa; devolve as frases que ficaram completas."""
        words = text.split()
        overlap = self._overlap(words)
        new = words[overlap:]
        self._recent = (self._recent + new)[-60:]
        sentences: list[str] = []
        for word in new:
            self._pending.append(word)
            if SENTENCE_END.search(word) or len(self._pending) >= self.max_words:
                sentences.append(" ".join(self._pending))
                self._pending = []
        return sentences

    @property
    def pending(self) -> str:
        return " ".join(self._pending)

    def flush(self) -> list[str]:
        if not self._pending:
            return []
        sentence, self._pending = " ".join(self._pending), []
        return [sentence]

    def _overlap(self, words: list[str]) -> int:
        """Maior começo da deixa nova que repete o fim do que já foi visto."""
        recent = [_key(w) for w in self._recent]
        keys = [_key(w) for w in words]
        for size in range(min(len(recent), len(keys)), 0, -1):
            if recent[-size:] == keys[:size]:
                return size
        return 0


Emit = Callable[[str, bool], Awaitable[None]]


async def follow_hls_captions(
    url: str,
    emit: Emit,
    *,
    realtime: bool = False,
    fetch: Callable[[str], str] = fetch_text,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> None:
    """Lê as legendas de uma transmissão HLS até ela acabar.

    `emit(texto, final)` recebe cada frase pronta (`final=True`) e o trecho ainda
    incompleto (`final=False`, para a legenda na tela). Num vídeo gravado com
    `realtime`, as deixas saem no tempo delas, como se fosse ao vivo.
    """
    master = await asyncio.to_thread(fetch, url)
    playlist_url = subtitle_playlist(master, url)
    if not playlist_url:
        raise CaptionError("A transmissão não tem legendas WebVTT (faixa SUBTITLES no HLS)")
    assembler = CaptionAssembler()
    seen: set[int] = set()
    clock_start: float | None = None
    loop = asyncio.get_running_loop()
    while True:
        playlist = parse_media_playlist(await asyncio.to_thread(fetch, playlist_url), playlist_url)
        for index, segment in enumerate(playlist.segments):
            number = playlist.sequence + index
            if number in seen:
                continue
            seen.add(number)
            for cue in parse_vtt(await asyncio.to_thread(fetch, segment)):
                if realtime:
                    if clock_start is None:
                        clock_start = loop.time() - cue.start
                    wait = clock_start + cue.start - loop.time()
                    if wait > 0:
                        await sleep(wait)
                for sentence in assembler.push(cue.text):
                    await emit(sentence, True)
                if assembler.pending:
                    await emit(assembler.pending, False)
        if playlist.ended:
            for sentence in assembler.flush():
                await emit(sentence, True)
            return
        await sleep(max(1.0, playlist.target_duration / 2))


def _escape(value: str, chars: str) -> str:
    return "".join("\\" + c if c in chars else c for c in value)


def embedded_captions_graph(url: str, protocols: str) -> str:
    """Filtro do ffmpeg que lê o vídeo e expõe o closed caption como legenda.

    O `movie` abre o endereço por conta própria, então a lista de protocolos
    permitidos vai junto, em `format_opts`. Os valores passam por dois níveis de
    escape: o das opções do filtro e o do grafo.
    """
    args = (
        "filename="
        + _escape(url, "\\':")
        + ":format_opts="
        + _escape(f"protocol_whitelist={protocols}", "\\':")
    )
    return "movie=" + _escape(args, "\\'[],;") + "[out+subcc]"


async def follow_embedded_captions(
    url: str,
    emit: Emit,
    *,
    ffmpeg: str,
    protocols: str,
    realtime: bool = False,
) -> None:
    """Lê o closed caption (CEA-608) embutido no vídeo, com o ffmpeg."""
    args = [
        ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        *(["-re"] if realtime else []),
        "-f",
        "lavfi",
        "-i",
        embedded_captions_graph(url, protocols),
        "-map",
        "0:1",
        "-flush_packets",
        "1",
        "-f",
        "srt",
        "pipe:1",
    ]
    try:
        process = await asyncio.create_subprocess_exec(
            *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
    except FileNotFoundError as error:
        raise CaptionError("ffmpeg não está instalado no servidor") from error
    assert process.stdout and process.stderr
    assembler = CaptionAssembler()
    found = False
    try:
        block: list[str] = []
        while line := await process.stdout.readline():
            text = line.decode("utf-8", errors="replace").rstrip("\r\n")
            if text:
                block.append(text)
                continue
            for cue in parse_vtt("\n".join(block)):
                found = True
                for sentence in assembler.push(cue.text):
                    await emit(sentence, True)
                if assembler.pending:
                    await emit(assembler.pending, False)
            block = []
        for sentence in assembler.flush():
            await emit(sentence, True)
        await process.wait()
    except asyncio.CancelledError:
        process.kill()
        raise
    if process.returncode != 0 or not found:
        detail = (await process.stderr.read()).decode(errors="replace")
        if "matches no streams" in detail or not found:
            raise CaptionError("A transmissão não tem legendas (nem WebVTT nem closed caption)")
        raise CaptionError(detail.strip().splitlines()[-1] if detail.strip() else "ffmpeg falhou")
