# Servidor de transcrição (Whisper)

Este servidor transcreve fala em português em tempo real para o AutoLibras Tradutor. Ele recebe o áudio do microfone por WebSocket, separa as frases pelas pausas com o Silero VAD e transcreve com o Whisper, via faster-whisper. Enquanto a pessoa fala, envia transcrições parciais para a legenda. Quando ela pausa, envia a frase final, que o app traduz para Libras.

Para transmissões, o servidor também guarda sessões: o áudio de uma live entra por WebSocket (pelo Estúdio) ou por um endereço RTMP, SRT ou HLS, que ele lê com o ffmpeg, e as frases vão para todos os overlays conectados à sessão. Veja o guia [Libras na sua live com o OBS](../../docs/transmissoes-obs.md).

O áudio vai só para este servidor, que pode rodar no seu próprio computador.

## Rodando com Docker

A imagem leva junto o app web, o Estúdio e o overlay, servidos no mesmo endereço do servidor. Ela é publicada pronta em `ghcr.io/lucas-arantes/autolibras` (`latest` para CPU, Intel/AMD e ARM; `gpu` para NVIDIA). Numa pasta com o `docker-compose.yml` da raiz:

```bash
docker compose up -d
```

Para montar a imagem a partir do código, na raiz do repositório:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

O `Dockerfile.gpu` monta a variante com CUDA. O [guia de hospedagem](../../docs/hospedagem.md) mostra como usar GPU e como pôr o servidor na internet com HTTPS.

Na primeira execução o servidor baixa o modelo (`small`, cerca de 480 MB) e o guarda no volume de modelos. O app abre em http://localhost:8000 e o Estúdio em http://localhost:8000/studio.html.

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

As sessões por endereço de transmissão precisam do `ffmpeg` instalado. Para servir também o app, faça o build dele (`npm run build -w @autolibras/web`) e aponte `AUTOLIBRAS_WEB_DIR` para `apps/web/dist`.

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
| `AUTOLIBRAS_ALLOWED_ORIGINS` | localhost, 127.0.0.1, o site publicado e extensões do Chrome | Páginas que podem usar o servidor, separadas por vírgula. Aceita `*` e porta curinga (`http://localhost:*`). Páginas servidas pelo próprio servidor são sempre aceitas |
| `AUTOLIBRAS_MAX_CONCURRENCY` | `1` | Quantas transcrições rodam ao mesmo tempo |
| `AUTOLIBRAS_MAX_SESSIONS` | `4` | Quantas sessões de transmissão podem existir ao mesmo tempo |
| `AUTOLIBRAS_TOKEN` | vazio | Senha para criar, listar e apagar sessões e para enviar áudio a elas. Vazio: sem senha. Defina sempre que o servidor estiver acessível pela rede |
| `AUTOLIBRAS_WEB_DIR` | vazio (`/app/web` no Docker) | Pasta com o build do app web, servida na raiz |
| `AUTOLIBRAS_DATA_DIR` | vazio (`/data` no Docker Compose) | Pasta onde fica o retorno do público (`feedback.jsonl`). Vazio: só os últimos 1000 ficam na memória |
| `AUTOLIBRAS_SIGNS_DIR` | vazio (`/signs` no Docker Compose) | Pacote de sinais do avatar próprio (pasta com `manifest.json`), servido em `/signs/` |

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

### Sessões de transmissão

Uma sessão tem uma entrada de áudio e quantos assinantes quiser. O id dela funciona como chave: quem tem o id pode acompanhar a sessão, mas criar, listar, apagar e enviar áudio pedem o token, quando `AUTOLIBRAS_TOKEN` está definido. O token vai no cabeçalho `Authorization: Bearer <token>` ou, nos WebSockets, no parâmetro `?token=`.

| Rota | O que faz |
|---|---|
| `POST /v1/sessions` | Cria uma sessão. Corpo: `{"source": {"type": "audio"}}`, `{"source": {"type": "text"}}` ou `{"source": {"type": "url", "url": "rtmp://…", "realtime": false, "captions": false}}`. O campo opcional `id` (16 a 64 letras, números, `-` ou `_`) fixa o id; se já existir uma sessão com ele, a antiga é encerrada. `realtime` faz o ffmpeg ler um vídeo gravado na velocidade normal. Com `captions`, a sessão usa a legenda da transmissão em vez da fala: primeiro a faixa WebVTT de um `.m3u8` (de preferência em português) e, sem ela, o closed caption CEA-608 embutido no vídeo |
| `GET /v1/sessions` | Lista as sessões |
| `GET /v1/sessions/{id}` | Estado da sessão (`waiting`, `live`, `ended` ou `error`), número de assinantes e `latency`: segundos do começo da fala até o final sair, nas últimas 50 frases (`p50`, `p95`) e o atraso sugerido para o modo sincronizado (`recommendedDelay`). Não pede token |
| `DELETE /v1/sessions/{id}` | Encerra a sessão e fecha as conexões dos assinantes |
| `POST /v1/sessions/{id}/text` | Texto pronto para a sessão, como uma legenda ou uma estenotipia: `{"text": "Boa noite.", "final": true}`. Com `final: false`, só atualiza a legenda na tela; o final vai para o avatar |
| `WS /v1/sessions/{id}/ingest` | Entrada das sessões `audio` e `text`, com o mesmo protocolo de `/v1/stream`, mais mensagens `{"type": "text", "text": "...", "final": true}`. Aceita uma conexão por vez |
| `WS /v1/sessions/{id}/events` | Saída para os assinantes. Primeiro chega `{"type": "session", ...}` com o estado, depois `partial`, `final` e `{"type": "state", "state": ..., "error": ...}` a cada mudança |

Os `final` das sessões trazem também `wallStart` e `wallEnd`, o horário (epoch, em segundos, no relógio do servidor) em que a fala começou e terminou, e `serverTime`, o horário do envio. O servidor estima esse horário pela chegada do áudio. Com eles, o overlay faz o modo sincronizado: com `atraso=N`, cada frase começa N segundos depois de ter sido dita, e o `serverTime` corrige a diferença entre os relógios do servidor e do computador do overlay.

Na fala corrida, uma frase completa (terminada em `.`, `?` ou `!`) que se repetiu em duas hipóteses seguidas sai como `final` sem esperar a pausa. Nesse caso, `start` e `end` são estimados pela proporção de palavras.

### Retorno do público

`POST /v1/feedback` recebe `{"rating": "good" | "bad", "comment": "...", "key": "...", "sentence": "...", "source": "form" | "player"}` de quem assiste, sem token, como JSON ou texto (o `navigator.sendBeacon` envia texto, e assim o player pode estar em outro site). Cada endereço pode enviar 10 por minuto. `key` é a `feedbackKey` da sessão, que o Estúdio põe no link do formulário `feedback.html?f=...`: ela separa o retorno de cada sessão sem revelar o id dela. `GET /v1/feedback?key=...` (com token) devolve o resumo e os retornos mais recentes.

Nas sessões por endereço, o ffmpeg só pode abrir `rtmp`, `rtmps`, `srt`, `http` e `https` (e os protocolos de que eles dependem, como HLS), para que ninguém use o servidor para ler arquivos do próprio disco. Sessões sem áudio chegando há mais de 15 minutos são encerradas quando outra sessão é criada.

## Testes

```bash
.venv/bin/pytest -q
```

O teste de integração usa o Whisper de verdade com voz sintética. Ele precisa do `espeak-ng` e do `ffmpeg` e baixa o modelo na primeira vez:

```bash
AUTOLIBRAS_INTEGRATION=1 .venv/bin/pytest tests/test_integration.py -s
```
