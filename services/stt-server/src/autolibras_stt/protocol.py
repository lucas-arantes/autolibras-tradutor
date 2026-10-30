"""Mensagens trocadas pelo WebSocket `/v1/stream`.

Cliente → servidor:
- frames binários com áudio PCM 16 bits little-endian, mono, 16 kHz;
- texto `{"type": "stop"}` para encerrar: o servidor transcreve o que falta,
  envia `stopped` e fecha a conexão.

Servidor → cliente (texto JSON):
- `{"type": "ready", "model": "small", "language": "pt", "sampleRate": 16000}`
- `{"type": "partial", "id": "s1", "text": "hoje eu vou", "stable": "hoje eu"}`:
  hipótese da frase em andamento; `stable` é o começo que já se repetiu em duas
  hipóteses seguidas e não deve mais mudar.
- `{"type": "final", "id": "s1", "text": "Hoje eu vou ao mercado.", "start": 1.2, "end": 3.4}`:
  frase encerrada (após uma pausa na fala); `start`/`end` em segundos desde o
  início da conexão. Um `final` substitui os `partial` com o mesmo `id`.
- `{"type": "error", "message": "..."}`
- `{"type": "stopped"}`
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

SAMPLE_RATE = 16_000


@dataclass(frozen=True)
class Partial:
    id: str
    text: str
    stable: str

    def to_json(self) -> dict[str, Any]:
        return {"type": "partial", "id": self.id, "text": self.text, "stable": self.stable}


@dataclass(frozen=True)
class Final:
    id: str
    text: str
    start: float
    end: float

    def to_json(self) -> dict[str, Any]:
        return {
            "type": "final",
            "id": self.id,
            "text": self.text,
            "start": round(self.start, 2),
            "end": round(self.end, 2),
        }


Event = Partial | Final


def ready(model: str, language: str) -> dict[str, Any]:
    return {"type": "ready", "model": model, "language": language, "sampleRate": SAMPLE_RATE}


def error(message: str) -> dict[str, Any]:
    return {"type": "error", "message": message}


STOPPED: dict[str, Any] = {"type": "stopped"}
