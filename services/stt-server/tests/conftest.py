from __future__ import annotations

import numpy as np
import pytest

from autolibras_stt.protocol import SAMPLE_RATE


def tone(seconds: float, amplitude: float = 0.3) -> np.ndarray:
    """Som contínuo, que o VAD por energia trata como fala."""
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    return (amplitude * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)


def pcm16(audio: np.ndarray) -> bytes:
    return (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()


def chunks(audio: np.ndarray, seconds: float = 0.1) -> list[bytes]:
    size = int(seconds * SAMPLE_RATE)
    return [pcm16(audio[i : i + size]) for i in range(0, len(audio), size)]


class FakeEngine:
    """Devolve hipóteses programadas, ou uma palavra por segundo de áudio."""

    name = "fake"

    def __init__(self, hypotheses: list[str] | None = None) -> None:
        self.hypotheses = list(hypotheses or [])
        self.calls: list[float] = []

    def transcribe(self, audio: np.ndarray) -> str:
        self.calls.append(len(audio) / SAMPLE_RATE)
        if self.hypotheses:
            return self.hypotheses.pop(0)
        return " ".join(["palavra"] * max(1, round(len(audio) / SAMPLE_RATE)))


@pytest.fixture
def engine() -> FakeEngine:
    return FakeEngine()
