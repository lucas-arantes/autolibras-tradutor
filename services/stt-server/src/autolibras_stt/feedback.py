"""Retorno do público: quem assiste diz se entendeu a sinalização.

O formulário público e o botão do player enviam `{"rating": "good"|"bad", ...}`
sem token, então o servidor limita o tamanho dos campos e quantos envios cada
endereço faz por minuto. Com `AUTOLIBRAS_DATA_DIR`, cada retorno vai para
`feedback.jsonl`; sem ele, só os últimos ficam na memória.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

Rating = Literal["good", "bad"]
MEMORY_LIMIT = 1_000


def feedback_key(session_id: str) -> str:
    """Chave pública do formulário de uma sessão, sem revelar o id (a chave do overlay)."""
    return hashlib.sha256(f"autolibras-feedback:{session_id}".encode()).hexdigest()[:16]


@dataclass(frozen=True)
class Feedback:
    time: float
    rating: Rating
    session: str | None
    comment: str
    sentence: str
    source: str
    page: str

    def to_json(self) -> dict[str, Any]:
        return {
            "time": round(self.time, 3),
            "rating": self.rating,
            "session": self.session,
            "comment": self.comment,
            "sentence": self.sentence,
            "source": self.source,
            "page": self.page,
        }


class RateLimiter:
    def __init__(self, per_minute: int = 10, now=time.time) -> None:  # noqa: ANN001
        self._limit = per_minute
        self._now = now
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, client: str) -> bool:
        now = self._now()
        hits = self._hits[client]
        while hits and now - hits[0] > 60:
            hits.popleft()
        if len(hits) >= self._limit:
            return False
        hits.append(now)
        if len(self._hits) > 10_000:
            # Muitos endereços diferentes: esquece os parados, para a memória não crescer.
            for key in [k for k, v in self._hits.items() if not v]:
                del self._hits[key]
        return True


class FeedbackStore:
    def __init__(self, data_dir: str = "") -> None:
        self._path = Path(data_dir) / "feedback.jsonl" if data_dir else None
        self._recent: deque[Feedback] = deque(maxlen=MEMORY_LIMIT)
        self._lock = threading.Lock()
        if self._path and self._path.is_file():
            with self._path.open(encoding="utf-8") as file:
                for line in deque(file, maxlen=MEMORY_LIMIT):
                    try:
                        self._recent.append(Feedback(**json.loads(line)))
                    except (TypeError, ValueError):
                        continue

    def add(self, feedback: Feedback) -> None:
        with self._lock:
            self._recent.append(feedback)
            if self._path:
                self._path.parent.mkdir(parents=True, exist_ok=True)
                with self._path.open("a", encoding="utf-8") as file:
                    file.write(json.dumps(feedback.to_json(), ensure_ascii=False) + "\n")

    def list(self, session: str | None = None, limit: int = 100) -> list[Feedback]:
        items = [f for f in self._recent if session is None or f.session == session]
        return items[-limit:][::-1]

    def summary(self, session: str | None = None) -> dict[str, int]:
        items = [f for f in self._recent if session is None or f.session == session]
        good = sum(1 for f in items if f.rating == "good")
        return {"good": good, "bad": len(items) - good}
