# Onde rodar o AutoLibras

O servidor do AutoLibras transcreve a fala e serve o Estúdio e o overlay. Ele pode rodar no mesmo computador do OBS, num computador da rede local ou num servidor na internet, com ou sem GPU.

## No computador de quem transmite (CPU)

É o caminho do guia [Libras na sua live com o OBS](transmissoes-obs.md): `docker compose up -d` com o `docker-compose.yml` do projeto. A imagem pronta funciona em computadores Intel/AMD e em Macs com Apple Silicon, e usa o modelo `small`.

Numa CPU de 12 threads, o `small` acompanhou a fala, e o primeiro sinal saiu de 2 a 3 segundos depois do fim de cada frase. Num computador mais fraco, ou ocupado com o próprio OBS, use `AUTOLIBRAS_MODEL=base`.

## Com GPU NVIDIA

Com uma GPU, os modelos maiores, que erram menos, ficam rápidos o bastante para a fala ao vivo. A imagem `ghcr.io/lucas-arantes/autolibras:gpu` usa CUDA 12 e o modelo `large-v3-turbo`. No computador, instale o driver da NVIDIA e o [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) e rode:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d
```

A variante com GPU ainda não foi testada pelo projeto numa GPU de verdade. Se ela não subir, os registros (`docker compose logs`) costumam dizer qual biblioteca da NVIDIA faltou.

## Num servidor na internet

Um servidor na internet serve para quem não quer rodar nada no próprio computador, ou para atender várias transmissões. Nesse caso:

- O Estúdio precisa de HTTPS: o navegador só libera o microfone em páginas seguras. O `docker-compose.hosted.yml` põe o [Caddy](https://caddyserver.com/) na frente do AutoLibras, e ele pede o certificado sozinho.
- A senha (`AUTOLIBRAS_TOKEN`) é obrigatória. Sem ela, qualquer pessoa criaria sessões no seu servidor.
- O domínio precisa apontar para o servidor, com as portas 80 e 443 abertas.

```bash
AUTOLIBRAS_DOMAIN=libras.exemplo.org AUTOLIBRAS_TOKEN=uma-senha-longa \
  docker compose -f docker-compose.yml -f docker-compose.hosted.yml up -d
```

Com GPU, acrescente `-f docker-compose.gpu.yml`. O Estúdio fica em `https://libras.exemplo.org/studio.html`, e o overlay sai do mesmo endereço.

Para uma live que já vai para um servidor RTMP, HLS ou SRT, a sessão por endereço da transmissão é a mais simples: o servidor lê a live sozinho, e ninguém precisa deixar o Estúdio aberto.

## Quanto custa

Preços de referência de outubro de 2026, tirados de comparadores de preço, não das tabelas oficiais. Confira no site de cada empresa antes de contratar, porque mudam com frequência.

| Opção | GPU | Preço aproximado | Uma live de 2 h |
|---|---|---|---|
| AWS `g4dn.xlarge` em São Paulo, sob demanda | NVIDIA T4 | US$ 0,89 por hora | cerca de US$ 1,80 |
| AWS `g4dn.xlarge` na Virgínia (EUA), sob demanda | NVIDIA T4 | US$ 0,53 por hora | cerca de US$ 1,05 |
| RunPod, nuvem comunitária | RTX 4090 | US$ 0,34 por hora | cerca de US$ 0,70 |
| Hetzner GEX44, servidor dedicado na Europa | RTX 4000 SFF Ada | € 184 a € 205 por mês, mais instalação | fixo, para uso frequente |
| Computador próprio, só CPU | nenhuma | a energia do computador | modelo `small` ou `base` |

Por hora, a GPU alugada só cobra enquanto a máquina está ligada: ligue antes da live e desligue depois. O servidor dedicado compensa para quem transmite quase todo dia. Servidores fora do Brasil acrescentam algumas dezenas de milissegundos de rede, o que pouco pesa perto dos segundos da transcrição.

Fontes dos preços: [AWS g4dn.xlarge por região](https://aws-pricing.com/g4dn.xlarge.html), [DoiT, g4dn.xlarge em sa-east-1](https://www.doit.com/compute/spot/sa-east-1/g4dn.xlarge), [RunPod](https://www.runpod.io/gpu-cloud/pricing), [Hetzner GEX44](https://www.hetzner.com/dedicated-rootserver/gex44/).
