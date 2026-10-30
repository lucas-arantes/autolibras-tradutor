"""Configuração por variáveis de ambiente (prefixo `AUTOLIBRAS_`)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from fnmatch import fnmatch

DEFAULT_ORIGINS = "http://localhost:*,http://127.0.0.1:*,https://lucas-arantes.github.io"


def _env(name: str, default: str) -> str:
    return os.environ.get(f"AUTOLIBRAS_{name}", default)


@dataclass(frozen=True)
class Settings:
    model: str = "small"
    device: str = "auto"
    compute_type: str = "auto"
    language: str = "pt"
    beam_size: int = 1
    host: str = "127.0.0.1"
    port: int = 8000
    # Origens de páginas que podem abrir o WebSocket. Aceita "*" e porta curinga.
    allowed_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(DEFAULT_ORIGINS.split(","))
    )
    # Transcrições simultâneas. Em CPU, mais de uma só divide o mesmo processador.
    max_concurrency: int = 1

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            model=_env("MODEL", "small"),
            device=_env("DEVICE", "auto"),
            compute_type=_env("COMPUTE_TYPE", "auto"),
            language=_env("LANGUAGE", "pt"),
            beam_size=int(_env("BEAM_SIZE", "1")),
            host=_env("HOST", "127.0.0.1"),
            port=int(_env("PORT", "8000")),
            allowed_origins=tuple(
                o.strip() for o in _env("ALLOWED_ORIGINS", DEFAULT_ORIGINS).split(",") if o.strip()
            ),
            max_concurrency=int(_env("MAX_CONCURRENCY", "1")),
        )

    def origin_allowed(self, origin: str | None) -> bool:
        # Clientes fora do navegador não mandam Origin e não são o risco aqui:
        # a checagem impede que qualquer site use o servidor pelo navegador do visitante.
        if origin is None:
            return True
        return any(pattern == "*" or fnmatch(origin, pattern) for pattern in self.allowed_origins)
