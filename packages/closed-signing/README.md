# @autolibras/closed-signing

Libras sob demanda em players de vídeo, como a legenda oculta. Quem assiste aperta o botão Libras, e o avatar próprio do AutoLibras aparece num canto do vídeo e sinaliza a legenda em português, no tempo dela.

O plugin lê a legenda que o vídeo já tem. Por isso funciona com vídeo gravado e com live em HLS que tenha legenda WebVTT, sem servidor do AutoLibras. Como cada frase começa quando a deixa da legenda aparece, a sinalização acompanha o vídeo mesmo com o atraso normal das lives e quando o espectador volta o vídeo.

## Uso

O site publicado serve a biblioteca num endereço fixo, `closed-signing.js`:

```html
<div class="player">
  <video src="aula.mp4" controls crossorigin="anonymous">
    <track kind="subtitles" srclang="pt" src="aula.vtt" />
  </video>
</div>
<script type="module">
  import { attachClosedSigning } from "https://lucas-arantes.github.io/autolibras-tradutor/closed-signing.js";

  const video = document.querySelector("video");
  const libras = attachClosedSigning(video, { signs: "https://…/pacote-de-sinais/" });
  document.querySelector(".player").after(libras.createButton());
</script>
```

Dentro deste repositório, importe de `@autolibras/closed-signing`.

O avatar começa desligado. `enable()`, `disable()` e `toggle()` ligam e desligam, e `createButton()` cria um botão com `aria-pressed` que faz o mesmo. Na primeira vez que liga, o plugin baixa o modelo e o pacote de sinais.

| Opção | Padrão | O que faz |
|---|---|---|
| `signs` | obrigatório (no `closed-signing.js`, o pacote do build do site) | Pacote de sinais do avatar (pasta com `manifest.json`) |
| `container` | o pai do `<video>` | Elemento sobre o qual o avatar aparece |
| `position` | `"right"` | Canto do vídeo: `"right"` ou `"left"` |
| `size` | `0.5` | Altura do avatar, como fração da altura do vídeo |
| `track` | a legenda em português, ou a primeira | Faixa de legenda a seguir |
| `translator` | regras locais | Tradutor de português para glosa. O padrão não envia texto a servidores |
| `vocabulary` | `true` | Baixa uma vez a lista de sinais do VLibras, para as regras reconhecerem mais palavras |
| `feedbackUrl` | nenhum | Endereço que recebe o retorno do público, como o `/v1/feedback` de um servidor do AutoLibras |
| `feedbackKey` | vazio | Chave enviada com o retorno, para separar vídeos ou canais |

Eventos (`libras.on(...)`): `toggle` (ligou ou desligou), `sentence` (frase que entrou na fila) e `error`.

Com `feedbackUrl`, `createFeedbackButtons()` cria os botões "Entendi" e "Não entendi". Cada clique envia a avaliação, a chave, a página e a última frase sinalizada com `navigator.sendBeacon`, que não precisa de CORS.

## Players

O plugin segue as `textTracks` do `<video>`. Ele foi testado com `<video>` e `<track>`. O hls.js, o video.js e o Shaka Player também põem as legendas nas `textTracks` e devem funcionar do mesmo jeito, mas ainda não foram testados. No hls.js, escolha a faixa em português (`hls.subtitleTrack`) e use `hls.subtitleDisplay = false` se a legenda não deve aparecer na tela; o avatar a acompanha mesmo escondida. A página [`assista.html`](../../apps/web/assista.html) do app é um exemplo com hls.js.

## Como funciona

1. A cada `cuechange`, o plugin pega as deixas novas, tira marcação, descrições de som como "(música)" e marcas de troca de falante (`>>`), e remove a repetição das legendas em rolagem.
2. As palavras viram frases, que fecham num ponto, interrogação ou exclamação, numa pausa da legenda ou com 14 palavras.
3. Cada frase vai para a mesma fila do app, que traduz para glosa e acelera o avatar quando a fala é mais rápida que a sinalização.
4. Quando o vídeo pula para outro ponto, a fila é esvaziada.

## Limitações

- O vídeo precisa de legenda em português. Sem ela, o avatar não tem o que sinalizar.
- Em tela cheia, o avatar só aparece se o player puser o elemento pai do vídeo em tela cheia, como o video.js faz. Com o `<video>` sozinho em tela cheia, o navegador esconde o resto da página.
- Uma legenda de outro domínio precisa de CORS e do atributo `crossorigin` no `<video>`.
- Pausar o vídeo não pausa o avatar: ele termina a frase em andamento.
