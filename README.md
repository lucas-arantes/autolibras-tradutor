# AutoLibras Tradutor

O AutoLibras Tradutor ouve português falado e mostra a tradução em Libras (Língua Brasileira de Sinais) com um avatar 3D, enquanto a pessoa fala. A fala vira texto, o texto vira glosa de Libras e o avatar sinaliza a glosa.

O projeto está no começo. Por enquanto existe só a versão web.

## Como funciona

```text
Microfone ─► Web Speech API (pt-BR) ─► Texto ─► Glosa (VLibras ou regras locais) ─► Fila ─► Avatar VLibras
```

O navegador transcreve a fala de forma contínua com a Web Speech API. Os resultados parciais aparecem como legenda antes de a frase terminar.

Cada frase transcrita vai para o tradutor de glosa do VLibras. Se ele falhar ou levar mais de 4 segundos, o app usa um tradutor de regras próprio, que roda no navegador. Também dá para usar só as regras, sem enviar o texto a nenhum servidor.

O avatar é o Widget oficial do VLibras, carregado dos servidores do governo quando a página abre. O app manda a glosa direto para o player do Widget.

A fala costuma ser mais rápida que a sinalização, então as frases passam por uma fila. Quando o atraso cresce, o avatar acelera. Se o atraso passa do limite configurado, as frases pendentes mais antigas são descartadas, mas o texto delas continua na legenda e no histórico. A fila mede quanto tempo cada sinal leva de fato e ajusta as estimativas com isso.

Também é possível digitar o texto. Isso funciona em qualquer navegador, mesmo sem microfone.

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
| `npm run build` | Build de produção (`apps/web/dist`) |
| `npm test` | Testes unitários (Vitest) |
| `npm run typecheck` | TypeScript e svelte-check |
| `npm run lint` | Lint e formatação (Biome) |

## Estrutura

```text
packages/
  core/          Interfaces (reconhecedor, tradutor, avatar), Pipeline, SignQueue, FallbackTranslator
  gloss-rules/   Tradutor PT→glosa por regras (verbos, plurais, números, expressões)
  stt-web/       Reconhecimento de fala via Web Speech API
  vlibras/       Adaptadores do VLibras: API de tradução, avatar do Widget, proteção contra captura de cliques
apps/
  web/           PWA em Svelte 5 + Vite
```

Cada etapa implementa uma interface definida em `@autolibras/core`. Por isso dá para trocar o reconhecedor de fala (por um baseado em Whisper, por exemplo), o tradutor ou o avatar sem mexer nas outras etapas.

## Limitações conhecidas

No Chrome, a Web Speech API envia o áudio do microfone para os servidores do Google. O Firefox não tem essa API; nele, use o campo de texto.

O tradutor e o avatar dependem de serviços públicos do VLibras que não têm API documentada nem garantia de disponibilidade. Os termos de uso do VLibras pedem consulta prévia para uso comercial ou eleitoral.

Quando o Widget do VLibras está aberto, ele intercepta os cliques da página para traduzir o texto clicado. O app evita isso marcando os próprios cliques com um sinalizador interno do Widget (versão 7). Esse sinalizador não é uma API pública, então uma atualização do Widget pode fazer os botões do app voltarem a ser capturados.

O avatar precisa de WebGL, e a janela do Widget fica fixa no canto direito da tela.

## Aviso

A tradução automática ajuda na acessibilidade, mas não substitui intérpretes de Libras, principalmente em contextos educacionais, jurídicos e audiovisuais (Lei 13.146/2015, art. 28).

## Licença

[MIT](LICENSE). Os serviços de terceiros usados em tempo de execução, como o VLibras (LGPL-3.0), têm licenças próprias e não fazem parte deste repositório. Veja [THIRD_PARTY.md](THIRD_PARTY.md).
