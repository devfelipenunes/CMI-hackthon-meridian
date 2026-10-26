#!/usr/bin/env bash
# Passo 0.1: confere a base antes de qualquer build. Falha alto quando os submódulos não
# foram inicializados: sem eles não há SDK, circuitos nem contratos para consumir.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail=0
ok() { printf '  ok   %s\n' "$1"; }
bad() { printf '  FALHA %s\n' "$1" >&2; fail=1; }

echo "toolchain"

# Node 22+ (o SDK usa WebCrypto e o `cryptoRng` do Node moderno).
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -ge 22 ]; then ok "node $(node -v)"; else bad "node $(node -v); este projeto pede >= 22"; fi
else
  bad "node não encontrado"
fi

# pnpm fixado no packageManager; corepack usa exatamente essa versão.
if command -v corepack >/dev/null 2>&1; then
  ok "corepack $(corepack --version)"
  wanted="$(node -p 'require("./package.json").packageManager')"
  actual="pnpm@$(corepack pnpm --version 2>/dev/null || echo '?')"
  if [ "$actual" = "$wanted" ]; then ok "$actual"; else bad "pnpm ativo $actual; packageManager pede $wanted"; fi
else
  bad "corepack não encontrado (habilite com corepack enable)"
fi

# Submódulos: SDK, contratos e specs. Um gitlink vazio deixa os arquivos abaixo ausentes.
check_file() {
  if [ -f "$1" ]; then ok "$1"; else bad "$1 ausente (submódulos inicializados?)"; fi
}

check_file "sdk/packages/core/src/index.ts"
check_file "sdk/packages/artifacts/dev-sources.json"
check_file "sdk/third_party/stellar-confidential-token-demo/packages/sdk/dist/index.js"
check_file "sdk/contracts/wasm/auction.wasm"
check_file "sdk/contracts/artifacts/circuits/bid_validity.json"
check_file "specs/POC/poc-5-live-confidential-token/circuits/artifacts/set_spender.json"

# O postinstall compila o @ctd/sdk; sem o build o Vite não resolve o pacote.
if [ -f "sdk/third_party/stellar-confidential-token-demo/packages/sdk/dist/index.js" ]; then
  ok "@ctd/sdk compilado"
else
  echo "  dica: corepack pnpm install" >&2
fi

if [ "$fail" -ne 0 ]; then
  echo >&2
  echo "toolchain incompleto. Rode 'git submodule update --init' e 'corepack pnpm install'." >&2
  exit 1
fi

echo "toolchain pronta"
