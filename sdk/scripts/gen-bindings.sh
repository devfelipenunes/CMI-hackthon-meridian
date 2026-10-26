#!/usr/bin/env bash










set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
contracts="$root/contracts"
factory="$contracts/target/wasm32v1-none/release/factory.wasm"

if [[ ! -f "$factory" ]]; then
  echo "-- build dos WASMs dos contratos (target/) --"
  (cd "$contracts" && stellar contract build >/dev/null)
fi

cd "$root/packages/testing"
pnpm -s exec tsx src/cli/gen-bindings.ts "$contracts/wasm/auction.wasm" "$factory" "$root/packages/core/src/bindings"
