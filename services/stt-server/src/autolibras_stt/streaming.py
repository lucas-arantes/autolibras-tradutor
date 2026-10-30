"""Transcrição em fluxo: transforma áudio contínuo em frases parciais e finais.

O Whisper não faz streaming nativo. A sessão guarda o áudio da frase em
andamento, usa o VAD para achar pausas e:
- a cada `partial_interval_s` de áudio novo, retranscreve a frase e envia um
  `partial`, marcando como estável o começo que se repetiu na hipótese anterior
  (política LocalAgreement-2);
- quando a fala pausa por `min_silence_s`, transcreve a frase inteira, envia o
  `final` e começa a próxima;
- se a frase passa de `max_utterance_s`, corta na última pausa interna.

Na fala corrida, sem pausas, uma frase completa (terminada em `.`, `?` ou `!`)
que já ficou estável em duas hipóteses seguidas sai como `final` na hora, sem
esperar a pausa (`early_finals`). O áudio dela continua no buffer até a pausa,
porque o Whisper não diz onde cada palavra termina; nas hipóteses seguintes,
as palavras já enviadas são descontadas.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np

from .engine import Engine
from .protocol import SAMPLE_RATE, Event, Final, Partial
from .vad import Vad


@dataclass(frozen=True)
class StreamingOptions:
    min_silence_s: float = 0.6
    partial_interval_s: float = 1.0
    step_interval_s: float = 0.25
    max_utterance_s: float = 15.0
    pad_s: float = 0.2
    early_finals: bool = True
    # Frases mais curtas que isso esperam a pausa (evita cortar "Sr." ou "Ah.").
    early_min_words: int = 3


SENTENCE_END = re.compile(r"[.?!…]['\")\]]*$")


def _normalize(word: str) -> str:
    return re.sub(r"[^\w]", "", word.lower())


def agreed_prefix(previous: list[str], current: list[str]) -> int:
    """Quantas palavras do começo das duas hipóteses coincidem."""
    count = 0
    for a, b in zip(previous, current, strict=False):
        if _normalize(a) != _normalize(b):
            break
        count += 1
    return count


class StreamingSession:
    def __init__(self, engine: Engine, vad: Vad, options: StreamingOptions | None = None) -> None:
        self._engine = engine
        self._vad = vad
        self._options = options or StreamingOptions()
        self._buffer = np.zeros(0, dtype=np.float32)
        # Posição absoluta (em amostras desde o início da conexão) de `_buffer[0]`.
        self._offset = 0
        self._since_step = 0
        self._since_partial = 0
        self._previous_words: list[str] = []
        self._segment = 1
        self._partial_sent = False
        # Palavras do começo da frase em andamento que já saíram num final antecipado.
        self._emitted: list[str] = []
        self._emitted_end = 0

    def _samples(self, seconds: float) -> int:
        return int(seconds * SAMPLE_RATE)

    @property
    def segment_id(self) -> str:
        return f"s{self._segment}"

    def append(self, pcm16: bytes) -> None:
        """Acrescenta áudio PCM 16 bits little-endian, mono, 16 kHz."""
        samples = np.frombuffer(pcm16, dtype="<i2").astype(np.float32) / 32768.0
        self._buffer = np.concatenate([self._buffer, samples])
        self._since_step += len(samples)
        self._since_partial += len(samples)

    def should_step(self) -> bool:
        return self._since_step >= self._samples(self._options.step_interval_s)

    def step(self) -> list[Event]:
        """Decide se envia parcial, final ou nada. Pode chamar o motor (lento)."""
        self._since_step = 0
        spans = self._vad(self._buffer)
        if not spans:
            self._drop_silence()
            return []

        pad = self._samples(self._options.pad_s)
        start = max(0, spans[0][0] - pad)
        last_end = spans[-1][1]
        if len(self._buffer) - last_end >= self._samples(self._options.min_silence_s):
            return self._finalize(start, min(len(self._buffer), last_end + pad))
        if len(self._buffer) - start >= self._samples(self._options.max_utterance_s):
            # Frase longa demais sem pausa: corta na última pausa interna, se houver.
            cut = spans[-2][1] + pad if len(spans) > 1 else len(self._buffer)
            return self._finalize(start, min(cut, len(self._buffer)))
        if self._since_partial >= self._samples(self._options.partial_interval_s):
            return self._partial(start)
        return []

    def flush(self) -> list[Event]:
        """Encerra a frase em andamento, se houver fala."""
        spans = self._vad(self._buffer)
        if spans:
            start = max(0, spans[0][0] - self._samples(self._options.pad_s))
            return self._finalize(start, len(self._buffer))
        if self._partial_sent:
            # Parciais sem fala confirmada: um final vazio apaga a legenda no cliente.
            return self._finalize(0, 0)
        return []

    def _drop_silence(self) -> None:
        # Guarda um pouco do fim: o VAD só marca fala depois de ~200 ms de som.
        keep = self._samples(0.5)
        if len(self._buffer) > keep:
            self._offset += len(self._buffer) - keep
            self._buffer = self._buffer[-keep:]

    def _strip_emitted(self, words: list[str]) -> list[str]:
        """Tira do começo da hipótese as palavras que já saíram num final antecipado."""
        if not self._emitted:
            return words
        matched = agreed_prefix(self._emitted, words)
        # Se a hipótese nova mudou alguma palavra já enviada, ainda assim pula o
        # mesmo número de palavras: repetir um trecho seria pior que perder um.
        return words[max(matched, len(self._emitted)) :]

    def _partial(self, start: int) -> list[Event]:
        self._since_partial = 0
        words = self._strip_emitted(self._engine.transcribe(self._buffer[start:]).split())
        previous = self._previous_words
        stable = words[: agreed_prefix(previous, words)]
        self._previous_words = words
        events: list[Event] = []
        if self._options.early_finals:
            cut = self._sentence_cut(stable, previous, words)
            if cut:
                events.append(self._early_final(stable[:cut], words, start))
                words, stable = words[cut:], stable[cut:]
                self._previous_words = words
        if words:
            self._partial_sent = True
            events.append(Partial(self.segment_id, " ".join(words), " ".join(stable)))
        return events

    def _sentence_cut(self, stable: list[str], previous: list[str], words: list[str]) -> int:
        """Fim da última frase completa dentro do trecho estável, ou 0.

        A pontuação tem de aparecer nas duas hipóteses, e alguma palavra tem de vir
        depois dela: o Whisper costuma pôr ponto no fim de um áudio cortado no meio
        da frase.
        """
        last = min(len(stable), len(words) - 1) - 1
        for index in range(last, self._options.early_min_words - 2, -1):
            if SENTENCE_END.search(stable[index]) and SENTENCE_END.search(previous[index]):
                return index + 1
        return 0

    def _early_final(self, sentence: list[str], words: list[str], start: int) -> Final:
        # Sem a posição das palavras no áudio, o fim é estimado pela proporção de palavras.
        total = len(self._emitted) + len(words)
        done = len(self._emitted) + len(sentence)
        utterance = len(self._buffer) - start
        begin = max(start, self._emitted_end)
        end = max(begin, start + int(utterance * done / max(total, 1)))
        final = Final(
            self.segment_id,
            " ".join(sentence),
            (self._offset + begin) / SAMPLE_RATE,
            (self._offset + end) / SAMPLE_RATE,
        )
        self._emitted += sentence
        self._emitted_end = end
        self._segment += 1
        self._partial_sent = False
        return final

    def _finalize(self, start: int, end: int) -> list[Event]:
        text = self._engine.transcribe(self._buffer[start:end]) if end > start else ""
        if self._emitted:
            text = " ".join(self._strip_emitted(text.split()))
            start = max(start, min(self._emitted_end, end))
        events: list[Event] = []
        if text or self._partial_sent:
            events.append(
                Final(
                    self.segment_id,
                    text,
                    (self._offset + start) / SAMPLE_RATE,
                    (self._offset + end) / SAMPLE_RATE,
                )
            )
            self._segment += 1
        self._buffer = self._buffer[end:]
        self._offset += end
        self._previous_words = []
        self._since_partial = 0
        self._partial_sent = False
        self._emitted = []
        self._emitted_end = 0
        return events
