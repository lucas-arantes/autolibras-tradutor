"""Configuração por variáveis de ambiente (prefixo `AUTOLIBRAS_`)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from fnmatch import fnmatch

# O app local, o site publicado e a extensão do navegador (origem chrome-extension://<id>).
DEFAULT_ORIGINS = (
    "http://localhost:*,http://127.0.0.1:*,https://lucas-arantes.github.io,chrome-extension://*"
)


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
    # Sessões de transmissão ao mesmo tempo.
    max_sessions: int = 4
    # Se definido, criar, listar e encerrar sessões e enviar áudio exigem este token.
    token: str = ""
    # Pasta com o build do app web, servido pelo próprio servidor (overlay do OBS).
    web_dir: str = ""
    # Pacote de sinais do avatar próprio (pasta com manifest.json), servido em /signs/.
    signs_dir: str = ""
    # Pasta para dados que devem sobreviver a reinícios (hoje, o retorno do público).
    data_dir: str = ""

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
            max_sessions=int(_env("MAX_SESSIONS", "4")),
            token=_env("TOKEN", ""),
            web_dir=_env("WEB_DIR", ""),
            signs_dir=_env("SIGNS_DIR", ""),
            data_dir=_env("DATA_DIR", ""),
        )

    def origin_allowed(self, origin: str | None, host: str | None = None) -> bool:
        # Clientes fora do navegador não mandam Origin e não são o risco aqui:
        # a checagem impede que qualquer site use o servidor pelo navegador do visitante.
        if origin is None:
            return True
        # Páginas servidas pelo próprio servidor (o overlay, acessado por localhost ou pelo IP).
        if host and origin.split("://", 1)[-1] == host:
            return True
        return any(pattern == "*" or fnmatch(origin, pattern) for pattern in self.allowed_origins)
