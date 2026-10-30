"""Detecção de voz (VAD). Devolve os trechos com fala em índices de amostra."""

from __future__ import annotations

from collections.abc import Callable

import numpy as np

SpeechSpans = list[tuple[int, int]]
Vad = Callable[[np.ndarray], SpeechSpans]


def silero_vad(threshold: float = 0.5, min_silence_ms: int = 300) -> Vad:
    """Silero VAD (MIT), na versão ONNX que acompanha o faster-whisper."""
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    options = VadOptions(
        threshold=threshold,
        min_silence_duration_ms=min_silence_ms,
        min_speech_duration_ms=200,
        speech_pad_ms=0,
    )

    def detect(audio: np.ndarray) -> SpeechSpans:
        return [(int(s["start"]), int(s["end"])) for s in get_speech_timestamps(audio, options)]

    return detect


def energy_vad(threshold: float = 0.02, frame: int = 480) -> Vad:
    """VAD simples por energia, para testes e máquinas sem onnxruntime."""

    def detect(audio: np.ndarray) -> SpeechSpans:
        spans: SpeechSpans = []
        start: int | None = None
        for offset in range(0, len(audio), frame):
            loud = float(np.sqrt(np.mean(audio[offset : offset + frame] ** 2))) > threshold
            if loud and start is None:
                start = offset
            elif not loud and start is not None:
                spans.append((start, offset))
                start = None
        if start is not None:
            spans.append((start, len(audio)))
        return spans

    return detect
