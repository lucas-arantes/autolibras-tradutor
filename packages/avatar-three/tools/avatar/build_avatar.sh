#!/usr/bin/env bash
# Baixa extensões e pacotes CC0 para <cache>, instala as extensões num perfil
# isolado do Blender e gera o avatar.
#
# Uso: build_avatar.sh <cache-dir> [saida.vrm]
# Variáveis: BLENDER (padrão: blender), SKIP_VERIFY=1 para pular a verificação.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="$(mkdir -p "${1:?uso: build_avatar.sh <cache-dir> [saida.vrm]}" && cd "$1" && pwd)"
OUT="${2:-$HERE/../../assets/autolibras.vrm}"
BLENDER="${BLENDER:-blender}"

# nome|url|sha256
DOWNLOADS=(
  "mpfb|https://extensions.blender.org/download/sha256:c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad/add-on-mpfb-v2.0.18.zip|c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad"
  "vrm|https://extensions.blender.org/download/sha256:cbcc06d6ef9a209126894f03d6221017e03bee08509d06bb14aa9522047bf9f5/add-on-vrm-v4.10.3.zip|cbcc06d6ef9a209126894f03d6221017e03bee08509d06bb14aa9522047bf9f5"
  "system|https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip|b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107"
  "faceunits|https://files.makehumancommunity.org/functional/faceunits01.zip|d113107bd7eb59f3af4df6fc0ec29bfcc593f496d0b336aec14f086a80ce7146"
  "visemes|https://files.makehumancommunity.org/functional/visemes01.zip|f61f4f36bb4fe43486efa2a644eea9d6760e510bde10eecc97a4ddf28424e4d3"
)

# Cada download fica numa pasta própria; os pacotes de assets são extraídos em assets/<nome>.
for entry in "${DOWNLOADS[@]}"; do
  IFS='|' read -r name url sum <<<"$entry"
  dir="$CACHE/downloads/$name"
  zip="$dir/$(basename "$url")"
  mkdir -p "$dir"
  if [[ ! -f "$zip" ]] || ! echo "$sum  $zip" | sha256sum -c --status; then
    echo ">> baixando $name"
    curl -fSL --retry 3 -o "$zip.part" "$url"
    mv "$zip.part" "$zip"
  fi
  echo "$sum  $zip" | sha256sum -c --quiet
  case "$name" in
    system|faceunits|visemes)
      if [[ ! -d "$CACHE/assets/$name" ]]; then
        mkdir -p "$CACHE/assets/$name"
        unzip -q "$zip" -d "$CACHE/assets/$name"
      fi ;;
  esac
done

# Perfil isolado: não mexe na configuração do Blender do usuário.
export BLENDER_USER_RESOURCES="$CACHE/blender-user"
for ext in mpfb vrm; do
  if [[ ! -d "$BLENDER_USER_RESOURCES/extensions/user_default/$ext" ]]; then
    "$BLENDER" -b --factory-startup --command extension install-file -r user_default \
      "$(ls "$CACHE/downloads/$ext"/*.zip)" --enable
  fi
done

"$BLENDER" -b --factory-startup --python-exit-code 1 --python "$HERE/build_avatar.py" -- \
  --assets "$CACHE/assets" --out "$OUT" --work "$CACHE/work"

if [[ "${SKIP_VERIFY:-0}" != "1" ]]; then
  "$BLENDER" -b --factory-startup --python-exit-code 1 --python "$HERE/verify_avatar.py" -- \
    --vrm "$OUT" --out-dir "$CACHE/previews"
fi
