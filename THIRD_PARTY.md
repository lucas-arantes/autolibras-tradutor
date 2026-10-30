# Componentes de terceiros

O código deste repositório usa a licença MIT e não inclui código nem assets de terceiros com licença incompatível.

## Serviços carregados em tempo de execução

O app usa estes serviços no navegador, mas não os redistribui.

| Componente | Uso | Licença e termos |
|---|---|---|
| VLibras Widget (`https://vlibras.gov.br/app/vlibras-plugin.js`) | Avatar 3D (player Unity) carregado no navegador | Código LGPL-3.0 ([spbgovbr-vlibras](https://github.com/spbgovbr-vlibras)); avatares e runtime Unity sem licença aberta; [termos do VLibras](https://www.gov.br/governodigital/pt-br/acessibilidade-e-usuario/vlibras) |
| Tradutor VLibras (`https://traducao2.vlibras.gov.br/translate`) | Tradução PT→glosa (opcional) | Serviço público sem API documentada, com os mesmos termos |
| Web Speech API | Reconhecimento de fala | Recurso do navegador; no Chrome, o Google processa o áudio |

O código de `packages/vlibras` foi escrito do zero com base no comportamento público do Widget (`window.VLibras.Widget` e `window.vlibras`) e não copia código LGPL.

## Servidor de transcrição

O servidor em `services/stt-server` instala estas dependências pelo pip. O modelo Whisper é baixado na primeira execução e não faz parte do repositório.

| Componente | Uso | Licença |
|---|---|---|
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | Transcrição com o Whisper | MIT |
| Modelos [Whisper](https://github.com/openai/whisper) da OpenAI | Pesos do modelo | MIT |
| [Silero VAD](https://github.com/snakers4/silero-vad), incluído no faster-whisper | Detecção de fala | MIT |
| CTranslate2 e ONNX Runtime | Execução dos modelos | MIT |
| FastAPI | Servidor HTTP e WebSocket | MIT |
| Uvicorn | Servidor ASGI | BSD-3-Clause |
| NumPy | Processamento do áudio | BSD-3-Clause |

## Dependências de desenvolvimento e build

Todas são instaladas pelo npm e têm licenças permissivas: Svelte (MIT), Vite (MIT), Vitest (MIT), TypeScript (Apache-2.0), Biome (MIT/Apache-2.0) e jsdom (MIT).
