#!/usr/bin/env bash


set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/contracts/artifacts"
LINK="$ROOT/packages/artifacts/releases/dev"

if [[ ! -f "$SRC/SHA256SUMS" ]]; then
  echo "erro: $SRC/SHA256SUMS não existe." >&2
  echo "       Os contratos geram artifacts/ a partir do passo 3.1 de lá (scripts/circuits.sh)." >&2
  exit 1
fi
ln -sfn "$SRC" "$LINK"
echo "ok: releases/dev → $SRC"
