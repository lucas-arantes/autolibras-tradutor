# @autolibras/avatar-three

Avatar próprio do AutoLibras: um modelo VRM desenhado com three.js e `@pixiv/three-vrm` que sinaliza glosas. É a alternativa ao player Unity do VLibras e implementa a mesma interface `AvatarRenderer` de `@autolibras/core`.

O app web já permite escolher este avatar no lugar do VLibras (veja [Uso no app](#uso-no-app)), mas ele ainda não foi avaliado por pessoas surdas.

## Como funciona

```text
Glosa ─► parser ─► sinais, letras ou placeholders ─► linha do tempo ─► poses no VRM
                                                    └► expressões e cabeça (pista separada)
```

O parser (`src/gloss.ts`) lê a glosa no formato do VLibras e das regras locais: `BOM_DIA`, `NÃO_GOSTAR`, `BONITO(+)`, `CASA&LUGAR`, `1S_IR_2S`, números e os marcadores `[PONTO]`, `[INTERROGAÇÃO]` e `[EXCLAMAÇÃO]`.

Em `src/timeline.ts`, cada sinal é procurado no pacote pelo nome completo e depois sem os sufixos. Se ele não estiver lá, o renderer tenta as partes de um sinal composto e, em seguida, soletra a palavra. Se faltar até a letra, entra um placeholder: o avatar fica parado em repouso por um instante e a demo mostra a palavra.

### Datilologia e números

A datilologia usa as 26 letras e o Ç do dicionário. Acentos são descartados (`JOÃO` vira J O A O). Letras soltas seguidas na glosa, como em `EU NOME A N A`, formam uma palavra soletrada e seguem o ritmo da datilologia. Uma letra sozinha continua sendo um sinal.

No meio de uma palavra, cada letra parada dura no máximo 0,35 s. As letras com movimento (H, J, K, X, Z e Ç, ou qualquer uma em que o punho se desloque) não são cortadas: tocam o trecho principal inteiro, até 0,9 s. Quando a mesma letra aparece duas vezes seguidas (`ANNA`), a segunda desliza uns 3 cm para fora, como se faz em Libras. O mesmo vale para algarismos repetidos (`11`).

Números sem sinal próprio no pacote saem algarismo por algarismo até quatro dígitos (`25`, `2010`), como se faz com idades, anos e horas. Com cinco dígitos ou mais, os grupos de milhar ganham os sinais `MIL` e `MILHÃO` (`25000` vira 2 5 MIL, e grupos zerados são pulados). A parte decimal vem depois de `VÍRGULA` (`3,5`). O separador de milhar com ponto (`1.500`) é aceito.

De cada sinal, a linha do tempo toca só o trecho principal, sem a ida e a volta do repouso. Entre um sinal e o próximo há um crossfade de 120 a 250 ms, com slerp osso a osso, que fica mais longo quando as mãos estão mais distantes. Sinais com `(+)` tocam mais devagar, e a velocidade escolhida vale para tudo.

### Expressões não manuais

As expressões vêm de duas fontes, combinadas a cada quadro.

A primeira é a gramática da frase, numa pista separada. Na pergunta sim/não, o avatar ergue as sobrancelhas (`browUp`) e inclina a cabeça um pouco para a frente. Na pergunta com QUE, ONDE, QUAL etc., franze a testa (`browDown`) e ergue um pouco o queixo. Na exclamação, usa `surprised`. Na negação, a cabeça balança e a testa franze. Sinais com `(+)` franzem a testa de leve.

A segunda é o próprio sinal. No rig do VLibras, os ossos do rosto movem shape keys por drivers, e o conversor grava o valor delas em cada quadro como canais de 0 a 1: sobrancelhas (`browRaise`, `browOuterUp`, `browLower`, `browFrown`, `browAngry`), boca (`smile`, `frown`, `pucker`, `lipPress`, `upperLip`, `jawOpen`) e bochechas (`cheekPuff`, `cheekSuck`). Assim, FELIZ sorri e ergue as sobrancelhas, TRISTE baixa os cantos da boca, GORDO enche as bochechas e OI faz bico, como na oralização. No crossfade, os canais de dois sinais se misturam com o mesmo peso das poses.

`FACE_EXPRESSIONS` (em `src/vrm-renderer.ts`) liga cada canal a uma expressão do VRM. O modelo do AutoLibras tem todas (veja [Modelo](#modelo)); outros modelos caem na alternativa mais próxima que tiverem, como `ou` para o bico ou `happy` para o sorriso, ou ignoram o canal. Numa pergunta, as sobrancelhas seguem a gramática, e as do sinal só entram no que sobrar. `faceWeight` (ou `setFaceWeight`) regula o peso das expressões do sinal; zero deixa só as da gramática.

As pálpebras e o olhar do VLibras ainda não são convertidos. O avatar pisca sozinho e olha para a câmera.

O avatar tem proporções diferentes das do avatar do VLibras, então copiar só as rotações tira a mão do lugar nos sinais com contato: em OBRIGADO, por exemplo, a mão iria parar no cabelo, e não na testa. Por isso cada clipe também diz onde a mão está em relação ao rosto, ao peito ou à outra mão, na escala de cada um (distância entre os olhos, largura dos ombros, comprimento da mão). A cada quadro, um IK de dois ossos (braço e antebraço) leva a mão do avatar ao mesmo lugar relativo, sem mudar a orientação da mão, e o peso da correção cai conforme a mão se afasta. Nos 53 sinais convertidos até agora, sem a correção a mão fica em média a 8,3 cm do ponto certo no rosto, a 3,1 cm no peito e a 8,9 cm em relação à outra mão. Com ela, a distância fica abaixo de 1,5 cm. A demo tem uma opção para desligar a correção e comparar.

Fora dos sinais, o avatar respira devagar (tórax e ombros), para não ficar congelado.

O renderer só calcula poses. Quem desenha é o `AvatarStage`: no navegador, `ThreeVrmStage`; nos testes, um palco falso com relógio manual.

```ts
import { createVrmRenderer } from "@autolibras/avatar-three";

const avatar = createVrmRenderer({
  canvas: document.querySelector("canvas")!,
  signs: "https://lucas-arantes.github.io/autolibras-sinais/BR/", // pasta com manifest.json
  background: null, // transparente
});
await avatar.load();
await avatar.play("OI [EXCLAMAÇÃO] EU NOME A N A [PONTO]");
```

Sem `avatarUrl`, o renderer usa o modelo do AutoLibras (`DEFAULT_AVATAR_URL`, que aponta para `assets/autolibras.vrm`). Com `new URL(..., import.meta.url)`, o Vite copia o arquivo para o build de quem importa o pacote.

### Fundo transparente

`background: null` (ou `"transparent"`) deixa o canvas transparente, para desenhar o avatar por cima de outra coisa, como no overlay do OBS. O WebGL é criado sempre com canal alfa, então `setBackground(cor | null)` troca o fundo a qualquer momento. A cor sai pré-multiplicada pelo alfa, que é o que o navegador e a fonte de navegador do OBS esperam. A página também precisa ter fundo transparente (`html, body { background: transparent }`).

## Uso no app

`apps/web/src/lib/avatar.ts` tem a fábrica comum às páginas do app:

```ts
import { createAvatar, defaultAvatarKind, parseAvatarKind } from "./lib/avatar";

const kind = parseAvatarKind(params.get("avatar")) ?? defaultAvatarKind();
const avatar = await createAvatar(kind, { signsUrl, background: null });
if (avatar.canvas) document.body.append(avatar.canvas);
const pipeline = new Pipeline({ translator, renderer: avatar.renderer });
```

`kind` é `"vlibras"` ou `"propio"` (`parseAvatarKind` aceita também `proprio` e `próprio`). O VLibras continua sendo o padrão enquanto não houver pacote de sinais. A URL do pacote vem de `VITE_SIGN_PACK_URL` no build ou das configurações. Na página principal, o avatar é escolhido nas configurações, e `SwitchableRenderer` troca um pelo outro sem recriar a fila. O `player.html` aceita `avatar=propio|vlibras` (ou um personagem do VLibras), `signs=URL` e `bg=transparent|<cor>`.

## Pacote de sinais (GPL-3.0, fora deste repositório)

Os clipes vêm do dicionário aberto do VLibras ([vlibras-dictionary-sources](https://gitlab.lavid.ufpb.br/vlibras-public/vlibras-dictionary/vlibras-dictionary-sources), GPL-3.0). Por isso ficam fora deste repositório MIT: são gerados localmente, ignorados pelo git e carregados por URL em tempo de execução. O pacote completo é montado e publicado num repositório à parte, `autolibras-sinais`, que chama os scripts daqui. O repositório de origem traz o texto da GPLv3 sem a cláusula "ou posterior", então os clipes saem marcados como GPL-3.0-only.

Para gerar um pacote, você precisa do Blender 4.5 ou mais recente e do Python 3:

```bash
python3 packages/avatar-three/tools/clips/build_pack.py --out packages/avatar-three/demo/public/signs OI BOM_DIA EU VOCÊ NOME CASA OBRIGADO GOSTAR NÃO QUAL TUDO_BEM ÁGUA A B C D E F G H I J K L M N O P Q R S T U V W X Y Z Ç
```

`--all` converte o dicionário inteiro (~23 mil sinais). Os `.blend` baixados (~60 GB) ficam em `~/.cache/autolibras/vlibras-sources`, e o script retoma de onde parou. Ele baixa e converte lote a lote. Um sinal que falha, seja no download ou no Blender, vai para `failures.json` sem parar os outros e é tentado de novo na próxima execução. `--ref` fixa o commit do dicionário, que fica registrado no `manifest.json` (`sourceCommit`). Alguns arquivos do repositório de origem têm o nome em NFD (o acento separado da letra), e o download tenta as duas formas.

A conversão (`tools/clips/vlibras_to_vrm.py`) roda no Blender headless:

1. Toca a animação FK de cada `.blend`, com as restrições desligadas, e lê a rotação e a posição de cada osso em cada quadro.
2. Leva as rotações para os ossos humanoides normalizados do VRM, cuja pose de descanso é a pose T com rotação identidade. A rotação de cada osso é a diferença em relação à pose T do VLibras, corrigida para que a direção do osso bata com a do segmento original. A torção do antebraço, que no VLibras fica em dois ossos, é dividida entre o antebraço e a mão.
3. Detecta o trecho principal do sinal (`strokeStart` e `strokeEnd`) pela distância e pela velocidade dos punhos. Num sinal parado, como a letra E, o trecho principal é uma pausa curta no meio do clipe.
4. Mede os contatos: para cada mão perto do rosto, do peito ou da outra mão, grava o deslocamento do ponto mais próximo da mão (punho, palma ou ponta de dedo) no referencial dessa âncora, com um peso que cai com a distância.
5. Lê, em cada quadro, as shape keys do rosto que os drivers do rig calcularam e as junta em canais de expressão (veja [Expressões não manuais](#expressões-não-manuais)). Cada canal é medido a partir do primeiro quadro, que é o rosto neutro do sinal, e só é gravado se passar de 0,08.
6. Grava um `.glb` por sinal com as rotações, os contatos e as expressões. Contatos e expressões vão em nós fictícios: `contact_<lado>_<âncora>_<ponto>`, com o deslocamento na translação e o peso na escala, e `face_<canal>`, com o peso na escala. Os quaternions ficam em int16 e os quadros-chave são reduzidos com erro máximo de 0,3° (0,02 de peso nas expressões), o que dá de 20 a 45 KB por sinal. Grava também as medidas de qualidade no `manifest.json`.

## Demo

```bash
npm run dev -w @autolibras/avatar-three
```

Abra http://localhost:5180. A demo usa `demo/public/signs` (gerado acima) e `assets/autolibras.vrm`. Os parâmetros `?signs=URL` e `?avatar=URL` trocam o pacote e o modelo, e `?bg=transparent` começa com o fundo transparente. Na página dá para ligar e desligar a correção de contatos, as expressões do sinal e o fundo transparente, além de procurar sinais no pacote.

`npm run check:browser -w @autolibras/avatar-three` abre a demo num Chromium headless com WebGL por software (SwiftShader), sinaliza algumas glosas e salva capturas de tela. Por padrão o script usa `/usr/bin/chromium`; outro caminho vai em `--chromium`.

## Modelo

`assets/autolibras.vrm` foi gerado com MakeHuman/MPFB a partir de assets CC0 (veja `tools/avatar/` e [THIRD_PARTY.md](../../THIRD_PARTY.md)). Além dos presets do VRM, ele tem as expressões `browUp` e `browDown` (gramática) e `mouthSmile`, `mouthFrown`, `mouthPucker`, `mouthPress`, `cheekPuff` e `cheekSuck` (expressões dos sinais), montadas com as unidades faciais ARKit do MakeHuman.
