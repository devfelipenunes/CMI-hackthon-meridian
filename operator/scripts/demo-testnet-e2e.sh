#!/usr/bin/env bash

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

deployment="${CMI_E2E_DEPLOYMENT:-deployments/demo-testnet.json}"
if [[ ! -f "$deployment" ]]; then
  echo "deployment ausente: $deployment" >&2
  echo "Defina CMI_E2E_DEPLOYMENT ou prepare o deployment de demonstração primeiro." >&2
  exit 1
fi

log_dir="${CMI_E2E_LOG_DIR:-.local/e2e-logs}"
mkdir -p "$log_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
log_file="$log_dir/testnet-e2e-$timestamp.log"
secret_dir="$(mktemp -d)"
secret_file="$secret_dir/spender"

cleanup() {
  if [[ -f "$secret_file" ]]; then shred -u "$secret_file"; fi
  rmdir "$secret_dir" 2>/dev/null || true
}
trap cleanup EXIT

corepack pnpm -s cli keys export spender --out "$secret_file" --i-understand >/dev/null
spender_key="$(tr -d '\n' < "$secret_file")"

echo "CMI Testnet E2E"
echo "  deployment: $deployment"
echo "  log:        $log_file"
echo "  roteiro:    criação → provas de lance → fechamento → alocação → liquidação → timeout"
echo

set -o pipefail
CMI_E2E_NETWORK=testnet \
CMI_E2E_DEPLOYMENT="$deployment" \
CMI_E2E_SPENDER_KEY="$spender_key" \
CMI_E2E_TRACE=1 \
corepack pnpm exec vitest run --project e2e --reporter=verbose 2>&1 | tee "$log_file"
