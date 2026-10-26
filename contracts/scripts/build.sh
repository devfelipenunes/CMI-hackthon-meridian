#!/usr/bin/env bash

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

stellar contract build "$@"






auction_wasm="target/wasm32v1-none/release/auction.wasm"
if [[ -f "$auction_wasm" ]]; then
  cp "$auction_wasm" wasm/auction.wasm
  echo "wasm/auction.wasm updated ($(sha256sum wasm/auction.wasm | cut -d' ' -f1))"
else
  echo "warning: $auction_wasm does not exist; wasm/auction.wasm left unchanged" >&2
fi
