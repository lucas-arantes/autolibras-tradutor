# Componentes de terceiros

O código deste repositório usa a licença MIT e não inclui código nem assets de terceiros com licença incompatível.

## Serviços carregados em tempo de execução

O app usa estes serviços no navegador, mas não os redistribui.

| Componente | Uso | Licença e termos |
|---|---|---|
| VLibras Widget (`https://vlibras.gov.br/app/vlibras-plugin.js`) | Avatar 3D (player Unity) carregado no navegador | Código LGPL-3.0 ([spbgovbr-vlibras](https://github.com/spbgovbr-vlibras)); avatares e runtime Unity sem licença aberta; [termos do VLibras](https://www.gov.br/governodigital/pt-br/acessibilidade-e-usuario/vlibras) |
| Tradutor VLibras (`https://traducao2.vlibras.gov.br/translate`) | Tradução PT→glosa (opcional) | Serviço público sem API documentada, com os mesmos termos |
| Lista de sinais do VLibras (`https://dicionario2.vlibras.gov.br/static/TREES/2018.3.1.json`) | Dicionário usado pelas regras locais, baixado uma vez e guardado no navegador | Dados do VLibras, com os mesmos termos; não ficam neste repositório |
| Web Speech API | Reconhecimento de fala | Recurso do navegador; no Chrome, o Google processa o áudio |
| Pacote de sinais do avatar próprio (`packages/avatar-three`, opcional) | Clipes de animação convertidos do [vlibras-dictionary-sources](https://gitlab.lavid.ufpb.br/vlibras-public/vlibras-dictionary/vlibras-dictionary-sources) (LAVID/UFPB), carregados por URL | GPL-3.0 (o repositório de origem traz o texto da GPLv3 sem a cláusula "ou posterior", então o pacote usa GPL-3.0-only). Os clipes ficam fora deste repositório e são publicados à parte |

O código de `packages/vlibras` foi escrito do zero com base no comportamento público do Widget (`window.VLibras.Widget` e `window.vlibras`) e não copia código LGPL.

Os scripts de conversão em `packages/avatar-three/tools/clips` foram escritos do zero e usam a licença MIT. Eles leem os arquivos `.blend` do VLibras, mas não copiam código nem dados deles para este repositório. O resultado da conversão é derivado das animações GPL-3.0 e, por isso, também é GPL-3.0. O `.gitignore` do pacote impede que esses clipes entrem aqui.

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

## Modelo do avatar próprio

`packages/avatar-three/assets/autolibras.vrm` foi gerado pelos scripts de `packages/avatar-three/tools/avatar` e é distribuído como CC0 (domínio público). Ele só usa assets CC0 do MakeHuman:

| Asset | Origem | Licença |
|---|---|---|
| Malha base, alvos de modelagem, rig "default" e pesos | Dados que acompanham o MPFB 2.0.18 | CC0 |
| Olhos `low-poly` (material `brown`), sobrancelhas `eyebrow001`, cílios `eyelashes01`, dentes `teeth_base`, língua `tongue01`, cabelo `short01`, roupa `male_casualsuit01`, sapatos `shoes06`, texturas de pele `young_african_male` e `young_caucasian_male` (misturadas) | [MakeHuman system assets](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html) (`makehuman_system_assets_cc0.zip`) | CC0 |
| Unidades faciais no estilo ARKit (base das expressões) | [Faceunits 01](https://files.makehumancommunity.org/functional/faceunits01.zip), de Mika Suominen | CC0 |
| Visemas `aa_02`, `y_iy_ih_ix_06`, `w_uw_07`, `ey_eh_uh_04`, `ow_08` | [Visemes 01](https://files.makehumancommunity.org/functional/visemes01.zip), de Mika Suominen | CC0 |

O MPFB (GPL-3.0-or-later) e o VRM Add-on for Blender (MIT) só são usados como ferramentas no build e não têm código nem dados dentro do `.vrm`.

O campo `licenseUrl` do arquivo aponta para a VRM Public License 1.0, porque a especificação VRM 1.0 e o three-vrm exigem essa URL. Todas as permissões do arquivo estão liberadas, e `otherLicenseUrl` aponta para a CC0.

## Dependências de desenvolvimento e build

Todas são instaladas pelo npm e têm licenças permissivas: Svelte (MIT), Vite (MIT), Vitest (MIT), TypeScript (Apache-2.0), Biome (MIT/Apache-2.0), jsdom (MIT), @types/chrome (MIT), three.js (MIT), @pixiv/three-vrm (MIT) e playwright-core (Apache-2.0, só na verificação da demo). A conversão dos sinais e o build do avatar usam o Blender (GPL-2.0-or-later) como programa externo.
