# AutoLibras Tradutor

O AutoLibras Tradutor ouve português falado e mostra a tradução em Libras (Língua Brasileira de Sinais) com um avatar 3D, enquanto a pessoa fala. A fala vira texto, o texto vira glosa de Libras e o avatar sinaliza a glosa.

O projeto está no começo. Por enquanto existem a versão web, publicada em https://lucas-arantes.github.io/autolibras-tradutor/, uma extensão do Chrome que traduz o áudio de outras abas (YouTube, Meet), um servidor de transcrição opcional e um overlay para pôr o avatar em transmissões ao vivo pelo OBS. Para falar em vez de digitar, use Chrome, Edge ou Safari, ou rode o servidor.

## Como funciona

```text
Microfone ─► Web Speech API ou servidor Whisper ─► Texto ─► Glosa (VLibras ou regras locais) ─► Fila ─► Avatar VLibras
```

A fala pode ser transcrita de dois jeitos. O padrão é a Web Speech API do navegador, que não exige instalar nada. A outra opção é o [servidor de transcrição do projeto](services/stt-server/README.md), que usa o Whisper e pode rodar no seu computador, assim o áudio não sai da máquina. Nos dois casos, os resultados parciais aparecem como legenda antes de a frase terminar.

Cada frase transcrita vai para o tradutor de glosa do VLibras. Se ele falhar ou levar mais de 4 segundos, o app usa um tradutor de regras próprio, que roda no navegador. Também dá para usar só as regras, sem enviar o texto a nenhum servidor. As regras baixam uma vez a lista de sinais do VLibras e a guardam no navegador; com ela, reconhecem verbos e expressões que não estão na lista do próprio pacote. Sem a lista, continuam funcionando.

O avatar padrão é o Widget oficial do VLibras, carregado dos servidores do governo quando a página abre. O app manda a glosa direto para o player do Widget. Nas configurações dá para trocar pelo [avatar próprio](packages/avatar-three/README.md), um modelo VRM aberto desenhado na própria página, quando houver um pacote de sinais configurado.

A fala costuma ser mais rápida que a sinalização, então as frases passam por uma fila. Quando o atraso cresce, o avatar acelera. Se o atraso passa do limite configurado, as frases pendentes mais antigas são descartadas, mas o texto delas continua na legenda e no histórico. A fila mede quanto tempo cada sinal leva de fato e ajusta as estimativas com isso.

Também é possível digitar o texto. Isso funciona em qualquer navegador, mesmo sem microfone.

A [extensão do Chrome](apps/extension/README.md) faz o mesmo com o áudio de uma aba, como um vídeo ou uma reunião, e mostra a legenda e o avatar sobre a página.

## Transmissões ao vivo

Com o Docker, um comando sobe o servidor de transcrição junto com o Estúdio e o overlay:

```bash
docker compose up -d
```

No Estúdio (http://localhost:8000/studio.html), você escolhe de onde vem o áudio: um dispositivo do computador (microfone, mesa de som, cabo virtual) ou o endereço da transmissão (RTMP, SRT ou HLS), que o servidor lê com o ffmpeg. O Estúdio mostra o endereço do overlay, que entra no OBS como fonte de navegador. O endereço não muda de uma live para outra. O passo a passo está em [Libras na sua live com o OBS](docs/transmissoes-obs.md).

Por enquanto o overlay usa o avatar do VLibras, cujos termos de uso não autorizam tradução automática em produções audiovisuais, e o player dele tem fundo opaco. O overlay serve para testes e demonstrações até o avatar próprio ficar pronto.

## Como rodar

Você precisa do Node.js 22 ou mais recente. Para o reconhecimento de fala, use Chrome, Edge ou Safari.

```bash
npm install
```

```bash
npm run dev
```

Abra http://localhost:5173. O avatar precisa de WebGL e leva alguns segundos para carregar.

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento do app web |
| `npm run build` | Build de produção do app e da extensão (`apps/web/dist` e `apps/extension/dist`) |
| `npm test` | Testes unitários (Vitest) |
| `npm run typecheck` | TypeScript e svelte-check |
| `npm run lint` | Lint e formatação (Biome) |
| `npm run dev -w @autolibras/avatar-three` | Demo do avatar próprio |
| `docker compose up -d` | Servidor de transcrição com o app, o Estúdio e o overlay em http://localhost:8000 |

## Estrutura

```text
packages/
  core/          Interfaces (reconhecedor, tradutor, avatar), Pipeline, SignQueue, FallbackTranslator
  gloss-rules/   Tradutor PT→glosa por regras (verbos, plurais, números, expressões), com ou sem o dicionário de sinais
  stt-web/       Reconhecimento de fala: Web Speech API, cliente do servidor Whisper e das sessões de transmissão
  vlibras/       Adaptadores do VLibras: API de tradução, avatar do Widget, proteção contra captura de cliques
  avatar-three/  Avatar próprio em VRM (three.js), que o app pode usar no lugar do VLibras
apps/
  web/           PWA em Svelte 5 + Vite. Também tem player.html (o avatar sozinho, usado pela extensão),
                 studio.html (Estúdio de transmissão) e broadcast.html (overlay do OBS)
  extension/     Extensão do Chrome (Manifest V3) que traduz o áudio de uma aba
services/
  stt-server/    Servidor de transcrição em Python (Whisper, VAD, WebSocket, sessões de transmissão)
```

Cada etapa implementa uma interface definida em `@autolibras/core`. Por isso dá para trocar o reconhecedor de fala, o tradutor ou o avatar sem mexer nas outras etapas. O [avatar próprio](packages/avatar-three/README.md) usa essa mesma interface e já pode ser escolhido no app. Ele vai substituir o do VLibras depois de avaliado por pessoas surdas.

## Limitações conhecidas

No Chrome, a Web Speech API envia o áudio do microfone para os servidores do Google. O Firefox não tem essa API; nele, use o servidor Whisper ou o campo de texto. O servidor Whisper precisa de uma máquina razoável: numa CPU de 12 threads, o modelo `small` acompanhou a fala, mas os modelos maiores pedem GPU.

O tradutor e o avatar dependem de serviços públicos do VLibras que não têm API documentada nem garantia de disponibilidade. Os termos de uso do VLibras pedem consulta prévia para uso comercial ou eleitoral.

Quando o Widget do VLibras está aberto, ele intercepta os cliques da página para traduzir o texto clicado. O app evita isso marcando os próprios cliques com um sinalizador interno do Widget (versão 7). Esse sinalizador não é uma API pública, então uma atualização do Widget pode fazer os botões do app voltarem a ser capturados.

O avatar precisa de WebGL, e a janela do Widget fica fixa no canto direito da tela.

## Contribuindo

Veja [CONTRIBUTING.md](CONTRIBUTING.md). Avaliações de pessoas surdas e intérpretes sobre a qualidade da sinalização ajudam muito.

## Aviso

A tradução automática ajuda na acessibilidade, mas não substitui intérpretes de Libras, principalmente em contextos educacionais, jurídicos e audiovisuais (Lei 13.146/2015, art. 28).

## Licença

[MIT](LICENSE). Os serviços de terceiros usados em tempo de execução, como o VLibras (LGPL-3.0), têm licenças próprias e não fazem parte deste repositório. Veja [THIRD_PARTY.md](THIRD_PARTY.md).
