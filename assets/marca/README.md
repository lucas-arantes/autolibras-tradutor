# Marca do AutoLibras

O símbolo é um balão de fala com uma mão aberta que sai pela borda de cima: o que é dito vira sinal. A mão é uma mão aberta, dedos unidos e polegar afastado, uma configuração de mão que existe na Libras. O logo evita de propósito o "ouvido" e o ouvido cortado, configurações de mão da ASL e o "L" com indicador e polegar, que no Brasil virou gesto político.

## Arquivos

| Arquivo | Uso |
|---|---|
| `logo.svg` | Logo completo (ícone + nome) em fundo claro |
| `logo-escuro.svg` | Logo completo em fundo escuro |
| `logo-mono.svg`, `logo-mono-branco.svg` | Logo completo em uma cor (preto ou branco), para impressão, carimbo, bordado |
| `simbolo.svg`, `simbolo-escuro.svg` | Só o símbolo, sem fundo, em fundo claro ou escuro |
| `simbolo-mono.svg`, `simbolo-mono-branco.svg` | Símbolo em uma cor |
| `icone.svg` | Ícone de app (quadrado arredondado) e favicon SVG |
| `icone-pequeno.svg` | Versão do ícone para 16 e 32 px, com contorno mais grosso |
| `icone-maskable.svg` | Ícone "maskable" do PWA: fundo até a borda, símbolo dentro da zona segura |
| `png/favicon.ico`, `png/favicon-16.png`, `png/favicon-32.png`, `png/favicon-48.png` | Favicons |
| `png/icon-192.png`, `png/icon-512.png`, `png/icon-maskable-512.png` | Ícones do manifesto do PWA |
| `png/apple-touch-icon.png` | Ícone da tela inicial no iPhone e iPad (180 px, sem transparência) |
| `png/logo.png`, `png/logo-escuro.png`, `png/simbolo.png`, `png/simbolo-escuro.png` | Para onde SVG não serve (slides, documentos) |

O nome está convertido em curvas, então os SVG não dependem de fonte instalada.

## Cores

| Nome | Hex | Onde |
|---|---|---|
| Verde-petróleo | `#0f6e78` | Cor principal: fundo do ícone, mão e "Libras" em fundo claro |
| Coral | `#ff7a59` | Contorno do balão em fundo claro |
| Menta | `#7fe0d6` | Contorno do balão no ícone e em fundo escuro |
| Tinta | `#1d2433` | "Auto" em fundo claro |
| Branco | `#ffffff` | Mão e nome em fundo escuro |

## Espaço e tamanho

- Deixe em volta do logo um espaço livre de pelo menos 1/4 da altura do ícone. No logo completo de 256 px de altura, são 64 px.
- Tamanho mínimo do logo completo: 120 px de largura na tela, 25 mm impresso. Abaixo disso, use só o ícone.
- Para 16 e 32 px, use `icone-pequeno.svg` ou os PNG de favicon. O `icone.svg` serve de 48 px para cima.

## Não faça

- Não estique, não incline e não gire o logo.
- Não troque as cores nem aplique degradê, sombra ou contorno.
- Não ponha o logo sobre foto ou fundo sem contraste. Em fundo escuro, use as versões `-escuro`; em fundo de outra cor, as monocromáticas.
- Não separe a mão do balão nem troque a mão por outra configuração.
- Não reescreva o nome em outra fonte. Use os arquivos prontos.
- Não use o logo para dizer que uma tradução foi feita ou revisada por intérpretes. O AutoLibras é tradução automática.

## Fontes e licenças

A mão vem do ícone `hand-back-right` do [Material Design Icons](https://pictogrammers.com/library/mdi/icon/hand-back-right/), da Pictogrammers, desenhado pelo Google e distribuído sob a licença Apache 2.0 (cópia em [`LICENSE-Apache-2.0.txt`](LICENSE-Apache-2.0.txt)). Alargamos os vãos entre os dedos e combinamos a mão com o balão.

O nome usa a Adwaita Sans, do projeto GNOME, nos pesos 500 e 800, sob a SIL Open Font License 1.1. O texto foi convertido em curvas.

O balão e a composição são desenho do próprio projeto, sob a licença MIT do repositório.
