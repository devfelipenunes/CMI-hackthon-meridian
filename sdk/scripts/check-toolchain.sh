#!/usr/bin/env bash



set -uo pipefail

fail=0

if ! command -v node >/dev/null 2>&1; then
  echo "erro: Node não encontrado (exigido: >= 22)" >&2
  fail=1
else
  node_version="$(node --version)"
  node_major="${node_version#v}"
  node_major="${node_major%%.*}"
  if [[ ! "$node_major" =~ ^[0-9]+$ ]] || (( node_major < 22 )); then
    echo "erro: Node $node_version encontrado; exigido >= 22" >&2
    fail=1
  else
    echo "ok: Node $node_version"
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "erro: pnpm não encontrado (packageManager do package.json)" >&2
  fail=1
else
  echo "ok: pnpm $(pnpm --version)"
fi

for optional in stellar docker; do
  if command -v "$optional" >/dev/null 2>&1; then
    echo "ok: $optional"
  else
    echo "aviso: $optional não encontrado (necessário a partir da fase 3)"
  fi
done

exit "$fail"
