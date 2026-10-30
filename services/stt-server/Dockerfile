# Servidor de transcrição para CPU. O modelo é baixado na primeira execução
# e fica no volume /models, para não baixar de novo a cada contêiner.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/models \
    AUTOLIBRAS_HOST=0.0.0.0 \
    AUTOLIBRAS_PORT=8000

WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir . \
    && useradd --create-home --uid 1000 app \
    && mkdir -p /models \
    && chown app /models

USER app
VOLUME /models
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"
CMD ["autolibras-stt"]
