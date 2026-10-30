"""Inicia o servidor: `python -m autolibras_stt`."""

from __future__ import annotations

import logging

import uvicorn

from .config import Settings
from .engine import FasterWhisperEngine
from .server import create_app
from .vad import silero_vad


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = Settings.from_env()
    logging.info("Carregando o modelo %s (%s)...", settings.model, settings.device)
    engine = FasterWhisperEngine(
        model=settings.model,
        device=settings.device,
        compute_type=settings.compute_type,
        language=settings.language,
        beam_size=settings.beam_size,
    )
    app = create_app(engine, silero_vad(), settings)
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")


if __name__ == "__main__":
    main()
