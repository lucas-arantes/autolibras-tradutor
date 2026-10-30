# AutoLibras para transmissões: o servidor de transcrição (Whisper, CPU) junto
# com o app web, o Estúdio e o overlay do OBS, todos no mesmo endereço.
# O modelo é baixado na primeira execução e fica no volume /models.

# 1. App web (Vite). Só o resultado do build passa para a imagem final.
FROM node:22-slim AS web
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && npm run build -w @autolibras/web

# 2. Servidor Python, com o ffmpeg para ler transmissões (RTMP, SRT, HLS).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models \
    AUTOLIBRAS_HOST=0.0.0.0 \
    AUTOLIBRAS_PORT=8000 \
    AUTOLIBRAS_WEB_DIR=/app/web

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY services/stt-server/pyproject.toml ./
COPY services/stt-server/src ./src
RUN pip install --no-cache-dir . \
    && useradd --create-home --uid 1000 app \
    && mkdir -p /models \
    && chown app /models
COPY --from=web /src/apps/web/dist ./web

USER app
VOLUME /models
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
CMD ["autolibras-stt"]
