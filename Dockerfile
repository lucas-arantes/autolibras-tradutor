# AutoLibras para transmissões: o servidor de transcrição (Whisper, CPU) junto
# com o app web, o Estúdio e o overlay do OBS, todos no mesmo endereço.
# O modelo é baixado na primeira execução e fica no volume /models.

# 1. App web (Vite). Só o resultado do build passa para a imagem final; como
# ele não depende da arquitetura, roda na plataforma de quem monta a imagem.
FROM --platform=$BUILDPLATFORM node:22-slim AS web
# Pacote de sinais do avatar próprio usado por padrão (GPL-3.0, publicado à parte).
ARG VITE_SIGN_PACK_URL=https://lucas-arantes.github.io/autolibras-sinais/BR/
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && VITE_SIGN_PACK_URL="$VITE_SIGN_PACK_URL" npm run build -w @autolibras/web

# 2. Servidor Python, com o ffmpeg para ler transmissões (RTMP, SRT, HLS).
FROM python:3.12-slim
LABEL org.opencontainers.image.source="https://github.com/lucas-arantes/autolibras-tradutor" \
      org.opencontainers.image.description="AutoLibras: transcrição ao vivo, Estúdio e overlay do OBS para pôr Libras em transmissões" \
      org.opencontainers.image.licenses="MIT"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models \
    AUTOLIBRAS_HOST=0.0.0.0 \
    AUTOLIBRAS_PORT=8000 \
    AUTOLIBRAS_WEB_DIR=/app/web \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY services/stt-server/pyproject.toml ./
COPY services/stt-server/src ./src
# Com o Playwright e o Chromium dele, o servidor também compõe a janela de Libras
# no vídeo (transmissão com a janela embutida).
RUN pip install --no-cache-dir ".[composicao]" \
    && python -m playwright install --with-deps chromium \
    && chmod -R a+rX /opt/playwright \
    && useradd --create-home --uid 1000 app \
    && mkdir -p /models /data \
    && chown app /models /data
COPY --from=web /src/apps/web/dist ./web

USER app
VOLUME /models /data
EXPOSE 8000 1935
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
CMD ["autolibras-stt"]
