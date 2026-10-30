# Libras na sua live com o OBS

Este guia põe o avatar do AutoLibras numa transmissão feita com o OBS Studio. O servidor do AutoLibras ouve o áudio da live, transcreve a fala e manda as frases para uma página que o OBS mostra como fonte de navegador. Funciona no Windows, no macOS e no Linux.

> [!IMPORTANT]
> Use o avatar próprio do AutoLibras na live. Ele tem fundo transparente e não depende dos serviços do VLibras. O Estúdio também oferece o avatar do VLibras, mas os termos de uso do VLibras não autorizam tradução automática em produções audiovisuais, então ele serve só para testes. O player do VLibras ainda tem fundo cinza-claro, e o avatar aparece dentro de um retângulo.

> [!NOTE]
> O avatar automático complementa o intérprete de Libras, mas não o substitui. Na TV, a lei exige a janela com intérprete (Lei 13.146/2015, art. 67).

## O que você precisa

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) no Windows ou no macOS. No Linux, o Docker Engine com o plugin `compose`.
- [OBS Studio](https://obsproject.com/) 28 ou mais recente.
- O pacote de sinais do avatar próprio, uma pasta com um `manifest.json` e um arquivo por sinal. Os sinais são convertidos do dicionário aberto do VLibras (GPL-3.0) e ficam fora deste repositório. Ainda não há um pacote publicado: para montar o seu, siga [o README do avatar](../packages/avatar-three/README.md#pacote-de-sinais-gpl-30-fora-deste-repositório), que pede o Blender.
- Internet, na primeira vez, para a lista de sinais que o tradutor local baixa do VLibras.
- Espaço em disco para a imagem e para o modelo de reconhecimento de fala (o `small` tem cerca de 480 MB).

## 1. Suba o servidor

Baixe o projeto (pelo botão **Code → Download ZIP** no GitHub ou com o `git`). Ponha o pacote de sinais numa pasta `sinais` dentro dele, com o `manifest.json` direto em `sinais/manifest.json`. Se o pacote estiver em outro lugar, indique o caminho em `AUTOLIBRAS_SIGNS`. Depois, na pasta do projeto, rode:

```bash
docker compose up -d
```

Na primeira vez, o Docker monta a imagem e o servidor baixa o modelo Whisper, o que leva alguns minutos. Depois disso, ele sobe em segundos e volta sozinho quando o computador reinicia. Para atualizar, baixe a versão nova do projeto e rode `docker compose up -d --build`.

Para conferir, abra <http://localhost:8000/health>. Deve aparecer `"status":"ok"`.

## 2. Escolha o áudio no Estúdio

Abra <http://localhost:8000/studio.html> num navegador atualizado.

Em **Áudio da transmissão**, escolha uma das opções:

- **Dispositivo de áudio deste computador**: o microfone de quem fala, a mesa de som ou a placa de captura. Clique em **Listar dispositivos** e escolha o certo. Se o som da live só existe dentro do OBS (vídeo, música, convidados), mande o monitor de áudio do OBS para um cabo virtual e escolha o cabo aqui: [VB-CABLE](https://vb-audio.com/Cable/) no Windows, [BlackHole](https://github.com/ExistentialAudio/BlackHole) no macOS e um `null-sink` do PipeWire ou do PulseAudio no Linux. A aba do Estúdio precisa ficar aberta durante a live.
- **Endereço da transmissão**: o servidor lê o áudio direto de um endereço `rtmp://`, `srt://` ou de uma playlist HLS (`.m3u8`), e o Estúdio pode ser fechado. Serve para quem tem o próprio servidor RTMP ou o endereço HLS da live. Um link de página, como `youtube.com/watch?v=…`, não funciona: é preciso o endereço do fluxo. Para testar com um vídeo gravado, marque **É um vídeo gravado**.

Clique em **Iniciar tradução**. Quando alguém falar, a transcrição aparece logo abaixo do botão.

## 3. Adicione o overlay no OBS

1. No Estúdio, em **Overlay no OBS**, clique em **Copiar**.
2. No OBS, em **Fontes**, clique em **+** e escolha **Navegador**.
3. Cole o endereço em **URL**. Com o avatar próprio, use **Largura** 400 e **Altura** 600; com o do VLibras, 260 e 380. Confirme.
4. Arraste a fonte para um canto da cena e amplie pelas bordas, se quiser.

O endereço do overlay não muda de uma live para outra, então esta etapa é feita uma vez só. Para trocar o avatar ou mostrar a frase embaixo dele, mude as opções no Estúdio e copie o endereço de novo.

## 4. Teste

Fale perto do microfone ou toque um vídeo. O avatar começa a sinalizar alguns segundos depois de cada frase: o servidor espera a pausa no fim da frase, transcreve, e o tradutor gera a glosa. Num teste em CPU com o modelo `small` e o avatar próprio, o primeiro sinal saiu cerca de 2 segundos depois do fim da fala; com o avatar e o tradutor do VLibras, cerca de 3 segundos. Quando a fala é rápida, as frases entram numa fila e o avatar acelera um pouco para não ficar para trás.

Para encerrar, clique em **Parar** no Estúdio. O avatar para de sinalizar e volta a funcionar sozinho na próxima vez que você iniciar, sem mexer no OBS.

## Problemas comuns

**O overlay não mostra nada.** Acrescente `&status=1` ao fim do endereço do overlay, na fonte do OBS, para ver o estado da conexão. "A sessão ainda não começou" quer dizer que falta clicar em **Iniciar tradução** no Estúdio. "Pacote de sinais não configurado" quer dizer que o servidor não achou `sinais/manifest.json`: confira a pasta e rode `docker compose up -d` de novo.

**Uma palavra sai soletrada.** O sinal dela não está no pacote, então o avatar faz a datilologia. O dicionário inteiro do VLibras tem cerca de 23 mil sinais; um pacote menor soletra mais palavras.

**O avatar fica muito atrás da fala.** O computador não está dando conta do modelo. Use um modelo menor: pare o servidor e suba de novo com `AUTOLIBRAS_MODEL=base docker compose up -d`. Fechar programas pesados também ajuda.

**O Estúdio e o OBS estão em computadores diferentes.** No `docker-compose.yml`, troque `"127.0.0.1:8000:8000"` por `"8000:8000"` e defina uma senha com `AUTOLIBRAS_TOKEN=uma-senha-longa docker compose up -d`. Abra o Estúdio pelo endereço do computador do servidor, como `http://192.168.0.10:8000/studio.html`, e digite a senha no campo que aparece. O overlay não pede senha: o id no endereço já funciona como chave.

**O endereço do overlay vazou.** Clique em **Gerar outro endereço** no Estúdio e cole o novo no OBS.

## Como funciona

```text
áudio da live ─► Estúdio (navegador) ─┐
                                       ├► servidor AutoLibras ─► overlay no OBS
endereço RTMP/SRT/HLS ─► ffmpeg ──────┘   (Whisper, por sessão)   (glosa + avatar)
```

O servidor guarda cada transmissão como uma sessão. O áudio de uma sessão chega pelo Estúdio ou pelo ffmpeg, e o servidor manda as frases a todos os overlays conectados a ela. A tradução para glosa e o avatar rodam no próprio overlay. A API das sessões está descrita em [`services/stt-server/README.md`](../services/stt-server/README.md).
