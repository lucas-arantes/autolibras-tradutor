# Extensão do Chrome

A extensão traduz para Libras o áudio de uma aba, como um vídeo do YouTube ou uma reunião do Meet. Ela mostra no canto da página uma janela com a legenda e o avatar do VLibras sinalizando o que está sendo dito.

A transcrição do áudio da aba depende do [servidor Whisper](../../services/stt-server/README.md), porque o reconhecimento de fala do navegador só aceita o microfone. O áudio vai só para esse servidor, que pode rodar no seu computador.

## Instalação

A extensão ainda não está na Chrome Web Store. Para instalar a partir do código:

```bash
npm install
```

```bash
npm run build -w @autolibras/extension
```

No Chrome, abra `chrome://extensions`, ative o "Modo do desenvolvedor", clique em "Carregar sem compactação" e escolha a pasta `apps/extension/dist`. O CI também publica essa pasta como artefato (`autolibras-extension`) em cada execução.

## Uso

1. Deixe o servidor Whisper rodando.
2. Abra a aba que você quer traduzir.
3. Clique no ícone do AutoLibras e em "Traduzir esta aba".

A janela aparece no canto inferior direito. "Mover" troca de canto e "Parar" encerra a tradução. O endereço do servidor, o tradutor de glosa e o avatar ficam nas configurações do popup.

## Como funciona

O Chrome entrega o áudio da aba (`tabCapture`) a um documento oculto da extensão, que devolve o som para os alto-falantes e o envia ao servidor Whisper. As transcrições voltam para a janela sobre a página, que mostra a legenda e repassa as frases completas ao player do avatar.

O player é a página `player.html` do app publicado, carregada dentro da janela da extensão. Ele faz a tradução para glosa e roda o avatar do VLibras. As extensões do Manifest V3 não podem executar código baixado da internet, então o avatar fica nessa página do app, e não na própria extensão.

## Permissões

| Permissão | Para quê |
|---|---|
| `tabCapture` | Capturar o áudio da aba escolhida |
| `offscreen` | Processar o áudio num documento oculto |
| `activeTab` e `scripting` | Pôr a janela do avatar na aba em que você clicou |
| `storage` | Guardar as configurações |
| Acesso a `localhost` | Falar com o servidor Whisper no seu computador |

## Limitações

Com o vídeo em tela cheia, a janela do avatar fica escondida. A extensão traduz uma aba por vez. Os testes automáticos usam uma página local com política de segurança restritiva; no YouTube e no Meet a extensão ainda precisa ser testada manualmente.
