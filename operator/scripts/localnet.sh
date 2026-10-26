#!/usr/bin/env bash








set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sdk="$root/../sdk"

case "${1:-}" in
  up)
    "$sdk/scripts/localnet.sh" up
    CMI_FINALIZATION_GRACE_LEDGERS="${CMI_FINALIZATION_GRACE_LEDGERS:-60}" "$sdk/scripts/deploy-local.sh"
    mkdir -p "$root/deployments"
    cp "$sdk/deployments/local.json" "$root/deployments/local.json"
    echo "ok: deployments/local.json"
    ;;
  down)
    "$sdk/scripts/localnet.sh" down
    rm -f "$root/deployments/local.json"
    ;;
  status)
    "$sdk/scripts/localnet.sh" status
    ;;
  *)
    echo "uso: $0 up|down|status" >&2
    exit 2
    ;;
esac
