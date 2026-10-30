# Servidor de transcrição (Whisper)

Este servidor transcreve fala em português em tempo real para o AutoLibras Tradutor. Ele recebe o áudio do microfone por WebSocket, separa as frases pelas pausas com o Silero VAD e transcreve com o Whisper, via faster-whisper. Enquanto a pessoa fala, envia transcrições parciais para a legenda. Quando ela pausa, envia a frase final, que o app traduz para Libras.

O áudio vai só para este servidor, que pode rodar no seu próprio computador.

## Rodando com Docker

```bash
docker build -t autolibras-stt services/stt-server
```

```bash
docker run --rm -p 8000:8000 -v autolibras-models:/models autolibras-stt
```

Na primeira execução o servidor baixa o modelo (`small`, cerca de 480 MB) e o guarda no volume `autolibras-models`.

## Rodando com Python

Precisa do Python 3.11 ou mais recente.

```bash
cd services/stt-server
```

```bash
python -m venv .venv && .venv/bin/pip install -e ".[dev]"
```

```bash
.venv/bin/autolibras-stt
```

Depois, no app, abra Configurações, escolha "Servidor Whisper" em Reconhecimento de fala e use o endereço `ws://localhost:8000/v1/stream`. Se você usa o site publicado, o Chrome pede permissão para o site acessar serviços deste dispositivo, e é preciso permitir.

## Configuração

Tudo é configurado por variáveis de ambiente.

| Variável | Padrão | O que faz |
|---|---|---|
| `AUTOLIBRAS_MODEL` | `small` | Modelo Whisper: `tiny`, `base`, `small`, `medium`, `large-v3`, `large-v3-turbo` |
| `AUTOLIBRAS_DEVICE` | `auto` | `cpu`, `cuda` ou `auto` (usa a GPU se houver) |
| `AUTOLIBRAS_COMPUTE_TYPE` | `auto` | Precisão do modelo; em `auto`, int8 na CPU e float16 na GPU |
| `AUTOLIBRAS_LANGUAGE` | `pt` | Idioma da fala |
| `AUTOLIBRAS_BEAM_SIZE` | `1` | Feixe de busca; valores maiores são mais precisos e mais lentos |
| `AUTOLIBRAS_HOST` | `127.0.0.1` (`0.0.0.0` no Docker) | Endereço em que o servidor escuta |
| `AUTOLIBRAS_PORT` | `8000` | Porta |
| `AUTOLIBRAS_ALLOWED_ORIGINS` | localhost, 127.0.0.1, o site publicado e extensões do Chrome | Páginas que podem usar o servidor, separadas por vírgula. Aceita `*` e porta curinga (`http://localhost:*`) |
| `AUTOLIBRAS_MAX_CONCURRENCY` | `1` | Quantas transcrições rodam ao mesmo tempo |

## Desempenho

Numa CPU de 12 threads, sem GPU, o modelo `small` em int8 processou 11,7 segundos de fala em 6,9 segundos, já contando as transcrições parciais. A frase final chegou ao app cerca de 1 segundo depois da pausa. Os modelos maiores, como o `large-v3-turbo`, precisam de GPU para acompanhar a fala.

A imagem Docker roda só em CPU. Para usar uma GPU NVIDIA, instale com Python numa máquina com CUDA 12 e cuDNN 9 e defina `AUTOLIBRAS_DEVICE=cuda`.

## Protocolo

`GET /health` informa o modelo carregado. O WebSocket `/v1/stream` recebe áudio PCM de 16 bits, mono, a 16 kHz, em mensagens binárias. Para encerrar, o cliente envia `{"type": "stop"}`: o servidor transcreve o que falta, responde `stopped` e fecha a conexão.

O servidor envia mensagens JSON:

| Tipo | Quando |
|---|---|
| `ready` | Logo após conectar, com o modelo e a taxa de amostragem |
| `partial` | Hipótese da frase em andamento. O campo `stable` traz o começo que já se repetiu em duas hipóteses seguidas |
| `final` | Frase encerrada, com início e fim em segundos. Substitui os `partial` de mesmo `id`; se vier com texto vazio, a frase foi descartada |
| `error` | Problema com a mensagem recebida ou com a transcrição |
| `stopped` | Resposta ao `stop` |

Os detalhes estão em [`src/autolibras_stt/protocol.py`](src/autolibras_stt/protocol.py).

## Testes

```bash
.venv/bin/pytest -q
```

O teste de integração usa o Whisper de verdade com voz sintética. Ele precisa do `espeak-ng` e do `ffmpeg` e baixa o modelo na primeira vez:

```bash
AUTOLIBRAS_INTEGRATION=1 .venv/bin/pytest tests/test_integration.py -s
```
