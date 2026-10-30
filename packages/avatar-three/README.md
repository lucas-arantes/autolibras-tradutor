# @autolibras/avatar-three

Avatar próprio do AutoLibras: um modelo VRM desenhado com three.js e `@pixiv/three-vrm` que sinaliza glosas. É a alternativa ao player Unity do VLibras e implementa a mesma interface `AvatarRenderer` de `@autolibras/core`.

Ainda é um primeiro marco e não está ligado ao app web.

## Como funciona

```text
Glosa ─► parser ─► sinais, letras ou placeholders ─► linha do tempo ─► poses no VRM
                                                    └► expressões e cabeça (pista separada)
```

O parser (`src/gloss.ts`) lê a glosa no formato do VLibras e das regras locais: `BOM_DIA`, `NÃO_GOSTAR`, `BONITO(+)`, `CASA&LUGAR`, `1S_IR_2S`, números e os marcadores `[PONTO]`, `[INTERROGAÇÃO]` e `[EXCLAMAÇÃO]`.

Em `src/timeline.ts`, cada sinal é procurado no pacote pelo nome completo e depois sem os sufixos. Se ele não estiver lá, o renderer tenta as partes de um sinal composto e, em seguida, soletra a palavra. Se faltar até a letra, entra um placeholder: o avatar fica parado em repouso por um instante e a demo mostra a palavra.

De cada sinal, a linha do tempo toca só o trecho principal, sem a ida e a volta do repouso. Entre um sinal e o próximo há um crossfade de 120 a 250 ms, com slerp osso a osso, que fica mais longo quando as mãos estão mais distantes. Sinais com `(+)` tocam mais devagar, e a velocidade escolhida vale para tudo.

As expressões faciais ficam numa pista separada. Na pergunta sim/não, o avatar ergue as sobrancelhas (`browUp`); na pergunta com QUE, ONDE, QUAL etc., franze a testa (`browDown`); na exclamação, usa `surprised`. Na negação, a cabeça balança e a testa franze. Se o modelo não tiver uma dessas expressões, o renderer usa a mais próxima que ele tiver.

O avatar tem proporções diferentes das do avatar do VLibras, então copiar só as rotações tira a mão do lugar nos sinais com contato: em OBRIGADO, por exemplo, a mão iria parar no cabelo, e não na testa. Por isso cada clipe também diz onde a mão está em relação ao rosto, ao peito ou à outra mão, na escala de cada um (distância entre os olhos, largura dos ombros, comprimento da mão). A cada quadro, um IK de dois ossos (braço e antebraço) leva a mão do avatar ao mesmo lugar relativo, sem mudar a orientação da mão, e o peso da correção cai conforme a mão se afasta. Nos 53 sinais convertidos até agora, sem a correção a mão fica em média a 8,3 cm do ponto certo no rosto, a 3,1 cm no peito e a 8,9 cm em relação à outra mão. Com ela, a distância fica abaixo de 1,5 cm. A demo tem uma opção para desligar a correção e comparar.

Fora dos sinais, o avatar respira devagar (tórax e ombros), para não ficar congelado.

O renderer só calcula poses. Quem desenha é o `AvatarStage`: no navegador, `ThreeVrmStage`; nos testes, um palco falso com relógio manual.

```ts
import { createVrmRenderer } from "@autolibras/avatar-three";

const avatar = createVrmRenderer({
  canvas: document.querySelector("canvas")!,
  avatarUrl: "/avatar/autolibras.vrm",
  signs: "https://exemplo.org/pacote-de-sinais/", // pasta com manifest.json
});
await avatar.load();
await avatar.play("OI [EXCLAMAÇÃO] EU NOME A N A [PONTO]");
```

## Pacote de sinais (GPL-3.0, fora deste repositório)

Os clipes vêm do dicionário aberto do VLibras ([vlibras-dictionary-sources](https://gitlab.lavid.ufpb.br/vlibras-public/vlibras-dictionary/vlibras-dictionary-sources), GPL-3.0). Por isso ficam fora deste repositório MIT: são gerados localmente, ignorados pelo git e carregados por URL em tempo de execução.

Para gerar um pacote, você precisa do Blender 4.5 ou mais recente e do Python 3:

```bash
python3 packages/avatar-three/tools/clips/build_pack.py --out packages/avatar-three/demo/public/signs OI BOM_DIA EU VOCÊ NOME CASA OBRIGADO GOSTAR NÃO QUAL TUDO_BEM ÁGUA A B C D E F G H I J K L M N O P Q R S T U V W X Y Z Ç
```

`--all` converte o dicionário inteiro (~23 mil sinais). Os `.blend` baixados ficam em `~/.cache/autolibras/vlibras-sources`, e o script retoma de onde parou.

A conversão (`tools/clips/vlibras_to_vrm.py`) roda no Blender headless:

1. Toca a animação FK de cada `.blend`, com as restrições desligadas, e lê a rotação e a posição de cada osso em cada quadro.
2. Leva as rotações para os ossos humanoides normalizados do VRM, cuja pose de descanso é a pose T com rotação identidade. A rotação de cada osso é a diferença em relação à pose T do VLibras, corrigida para que a direção do osso bata com a do segmento original. A torção do antebraço, que no VLibras fica em dois ossos, é dividida entre o antebraço e a mão.
3. Detecta o trecho principal do sinal (`strokeStart` e `strokeEnd`) pela distância e pela velocidade dos punhos. Num sinal parado, como a letra E, o trecho principal é uma pausa curta no meio do clipe.
4. Mede os contatos: para cada mão perto do rosto, do peito ou da outra mão, grava o deslocamento do ponto mais próximo da mão (punho, palma ou ponta de dedo) no referencial dessa âncora, com um peso que cai com a distância.
5. Grava um `.glb` por sinal com as rotações e os contatos, estes em nós fictícios (`contact_<lado>_<âncora>_<ponto>`, translação = deslocamento, escala = peso). Os quaternions ficam em int16 e os quadros-chave são reduzidos com erro máximo de 0,3°, o que dá de 20 a 35 KB por sinal. Grava também as medidas de qualidade no `manifest.json`.

## Demo

```bash
npm run dev -w @autolibras/avatar-three
```

Abra http://localhost:5180. A demo usa `demo/public/signs` (gerado acima) e `demo/public/avatar/autolibras.vrm`. Os parâmetros `?signs=URL` e `?avatar=URL` trocam o pacote e o modelo.

`npm run check:browser -w @autolibras/avatar-three` abre a demo num Chromium headless com WebGL por software (SwiftShader), sinaliza algumas glosas e salva capturas de tela. Por padrão o script usa `/usr/bin/chromium`; outro caminho vai em `--chromium`.

## Modelo

`demo/public/avatar/autolibras.vrm` foi gerado com MakeHuman/MPFB a partir de assets CC0 (veja `tools/avatar/` e [THIRD_PARTY.md](../../THIRD_PARTY.md)).
