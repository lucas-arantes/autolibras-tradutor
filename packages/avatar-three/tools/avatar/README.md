# Avatar AutoLibras

Scripts que geram `demo/public/avatar/autolibras.vrm` (VRM 1.0, CC0) a partir do
MakeHuman/MPFB, rodando o Blender sem interface.

## Como gerar

Precisa do Blender 4.5 no PATH (ou em `BLENDER=...`), `curl`, `unzip` e `sha256sum`.

```sh
packages/avatar-three/tools/avatar/build_avatar.sh ~/.cache/autolibras-avatar
```

O script baixa as extensões e os pacotes de assets para o diretório de cache, confere
o sha256 de cada arquivo, instala as extensões num perfil separado do Blender
(`BLENDER_USER_RESOURCES`) e roda `build_avatar.py`. No fim, `verify_avatar.py`
reimporta o modelo e grava prévias em `<cache>/previews`. O build leva cerca de um minuto.

Para testar outro cabelo do pacote de sistema, passe `--hair <pasta>` ao `build_avatar.py`. O padrão é `short01`, que deixa a testa livre. Cabelos com franja escondem parte das sobrancelhas, que fazem parte da gramática da Libras.

`check_vrm.mjs` carrega o arquivo com `@pixiv/three-vrm` no Node e imprime ossos,
expressões e direções da pose T.

## Convenções do modelo

- Olha para +Z no glTF. A esquerda do modelo fica em +X.
- Pose de repouso em T: braços e dedos retos em ±X, palmas para baixo, polegares a 45°
  entre ±X e +Z, pernas retas para baixo.
- Mapa humanoide completo, com todos os dedos, `jaw` e olhos.
- Expressões (shape keys na malha `Body`): os presets do VRM (`happy`, `angry`, `sad`,
  `surprised`, `relaxed`, `blink`, `blinkLeft`, `blinkRight`, `aa`, `ih`, `ou`, `ee`, `oh`)
  e duas customizadas: `browUp` (pergunta sim/não) e `browDown` (perguntas QU- e negação).
- `licenseUrl` é a VPL 1.0, porque o three-vrm recusa outras URLs por padrão. A licença
  real fica em `otherLicenseUrl` (CC0), com todas as permissões liberadas.

## Assets usados (todos CC0)

Vêm do pacote "MakeHuman system assets" e dos pacotes funcionais "Faceunits 01" e
"Visemes 01" (<https://static.makehumancommunity.org/assets/assetpacks.html>), mais a
malha base, os alvos de modelagem e o rig "default" que acompanham o MPFB. A lista
exata está em `build_avatar.py` (`PROXIES`, `SKIN_TEXTURES`, `EXPRESSIONS`).
