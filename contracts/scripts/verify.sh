#!/usr/bin/env bash
# Usage: scripts/verify.sh
#
# Runs every check the repository needs: tool versions, rustfmt, clippy, Rust and
# Noir tests, the versioned circuit artifacts and the WASMs/VKs.

set -euo pipefail

export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

step() {
  echo ""
  echo "== $* =="
}

step "tools"
for t in cargo rustc nargo bb jq sha256sum; do
  command -v "$t" >/dev/null || {
    echo "missing $t (see README.md > Toolchain)" >&2
    exit 1
  }
done

expected_rust="$(sed -n 's/^channel = "\(.*\)"/\1/p' rust-toolchain.toml)"
actual_rust="$(rustc --version | awk '{print $2}')"
if [[ "$actual_rust" != "$expected_rust" ]]; then
  echo "rustc: expected $expected_rust, found $actual_rust" >&2
  exit 1
fi

step "rustfmt"
cargo fmt --all -- --check

step "clippy"
cargo clippy --all-targets --all-features -- -D warnings

step "rust tests"
cargo test

step "noir tests"
( cd circuits && nargo test )

step "circuit artifacts and nargo/bb versions"
./scripts/circuits.sh --check

step "WASMs and token VKs"
./scripts/check-wasm.sh

echo ""
echo "OK: the repository is consistent"
