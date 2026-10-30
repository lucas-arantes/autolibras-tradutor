"""Motores de transcrição. O servidor depende só do protocolo `Engine`."""

from __future__ import annotations

import os
import re
from typing import Protocol

import numpy as np

# Frases que o Whisper costuma "ouvir" em silêncio ou ruído, vindas das legendas
# usadas no treino. Uma transcrição composta só delas é descartada.
HALLUCINATIONS = (
    "legendas pela comunidade amara.org",
    "legenda adriana zanotto",
    "obrigado por assistir",
    "obrigada por assistir",
    "inscreva-se no canal",
    "não se esqueça de se inscrever",
)


def is_hallucination(text: str) -> bool:
    normalized = re.sub(r"[^\w\s.-]", "", text.lower()).strip(" .")
    return not normalized or normalized in HALLUCINATIONS


class Engine(Protocol):
    name: str

    def transcribe(self, audio: np.ndarray) -> str:
        """Transcreve áudio float32 mono a 16 kHz."""
        ...


class FasterWhisperEngine:
    """Whisper via CTranslate2. `small` com int8 roda em CPU; `large-v3-turbo` pede GPU."""

    def __init__(
        self,
        model: str = "small",
        device: str = "auto",
        compute_type: str = "default",
        language: str = "pt",
        beam_size: int = 1,
        cpu_threads: int = 0,
    ) -> None:
        import ctranslate2
        from faster_whisper import WhisperModel

        if device == "auto":
            device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        if compute_type in ("auto", "default"):
            # Os modelos vêm em float16; em CPU o CTranslate2 cairia para float32, bem mais lento.
            compute_type = "float16" if device == "cuda" else "int8"

        self.name = model
        self.device = device
        self.compute_type = compute_type
        self.language = language
        self.beam_size = beam_size
        self._model = WhisperModel(
            model,
            device=device,
            compute_type=compute_type,
            cpu_threads=cpu_threads or os.cpu_count() or 4,
        )

    def transcribe(self, audio: np.ndarray) -> str:
        segments, _ = self._model.transcribe(
            audio,
            language=self.language,
            beam_size=self.beam_size,
            # A segmentação por fala é feita antes, no servidor.
            vad_filter=False,
            # Sem contexto entre trechos: evita repetir alucinações de um trecho no outro.
            condition_on_previous_text=False,
            without_timestamps=True,
        )
        texts = [
            segment.text.strip()
            for segment in segments
            if not (segment.no_speech_prob > 0.6 and segment.avg_logprob < -1.0)
        ]
        text = " ".join(t for t in texts if t)
        return "" if is_hallucination(text) else text
