"""Teste com o Whisper real e voz sintética. Rode com AUTOLIBRAS_INTEGRATION=1.

Precisa de `espeak-ng` e `ffmpeg` para gerar o áudio e baixa o modelo na
primeira execução (`small`: ~480 MB). Mede também a velocidade em relação ao
tempo real, que decide se a máquina aguenta tradução ao vivo.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import time
from pathlib import Path

import numpy as np
import pytest
from conftest import chunks

from autolibras_stt.engine import FasterWhisperEngine
from autolibras_stt.protocol import SAMPLE_RATE, Final
from autolibras_stt.streaming import StreamingSession, _normalize
from autolibras_stt.vad import silero_vad

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("AUTOLIBRAS_INTEGRATION") != "1", reason="AUTOLIBRAS_INTEGRATION != 1"
    ),
    pytest.mark.skipif(
        not (shutil.which("espeak-ng") and shutil.which("ffmpeg")), reason="sem espeak-ng/ffmpeg"
    ),
]

SENTENCES = [
    "Bom dia, tudo bem?",
    "Hoje eu vou estudar na biblioteca com meus amigos.",
    "Ele não gosta de café.",
]


def speak(text: str, path: Path) -> np.ndarray:
    raw = path.with_suffix(".raw.wav")
    subprocess.run(["espeak-ng", "-v", "pt-br", "-s", "145", "-w", str(raw), text], check=True)
    pcm = subprocess.run(
        [
            "ffmpeg",
            "-loglevel",
            "error",
            "-i",
            str(raw),
            "-f",
            "s16le",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-",
        ],
        check=True,
        capture_output=True,
    ).stdout
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0


def words(text: str) -> set[str]:
    return {_normalize(w) for w in text.split()} - {""}


def test_transcreve_frases_separadas_por_pausas(tmp_path: Path) -> None:
    pause = np.zeros(SAMPLE_RATE, dtype=np.float32)
    parts = [pause]
    for i, sentence in enumerate(SENTENCES):
        parts += [speak(sentence, tmp_path / f"f{i}"), pause]
    audio = np.concatenate(parts)

    engine = FasterWhisperEngine(model=os.environ.get("AUTOLIBRAS_MODEL", "small"))
    session = StreamingSession(engine, silero_vad())
    events = []
    started = time.perf_counter()
    for chunk in chunks(audio):
        session.append(chunk)
        if session.should_step():
            events += session.step()
    events += session.flush()
    elapsed = time.perf_counter() - started

    finals = [e for e in events if isinstance(e, Final)]
    print(f"\nÁudio: {len(audio) / SAMPLE_RATE:.1f} s; processamento: {elapsed:.1f} s")
    for final in finals:
        print(f"  {final.id} [{final.start:.1f}-{final.end:.1f}] {final.text}")

    assert len(finals) == len(SENTENCES)
    for final, sentence in zip(finals, SENTENCES, strict=True):
        expected = words(sentence)
        # Voz sintética é difícil: exige 70% das palavras certas em cada frase.
        assert len(expected & words(final.text)) >= 0.7 * len(expected), final.text
