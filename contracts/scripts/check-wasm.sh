#!/usr/bin/env bash







set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"






expected() {
  cat <<'EOF'
ultrahonk_verifier.wasm 7ec8c9e50a1a2862652074bcd6df6b46e17180253c95da981db72e28e93b8e70
confidential_token.wasm 74b6978c0519e6a1807f54a9677c47555a7f696a3d336603a79b63773f4fb6d8
confidential_verifier.wasm 0ececaae8cbd3c78f19d9057d80a73799b35468074081dc2d92bebe91b2e3552
confidential_auditor.wasm 43303f4421d2bab6020f8a82312f09533c3612509677a646792b9c82cb31d05f
vks/register.vk.bin 79a2f5f78e0466d711745c3e0ab0d974065ed5f6abcda3cebb80d5e5d4a839b0
vks/withdraw.vk.bin 7c9e5e55409617123e6a48cd8e92b10f6f71d2bb00f23b11115307d396098d19
vks/transfer.vk.bin 7d3de3ce979e3f42d44afdfd4e90774ad540d75920c66939cb2cebaad9bd373d
vks/spender_transfer.vk.bin 22e42d3b9dfc38fa22c22c9335e37a47e756d895ed3b0226fece38ce46277e6c
vks/set_spender.vk.bin fc0bf2fd65b036d1e838e641eafae46b01e9f45bcc433a33e7d0eac433ab3dbe
vks/revoke_spender.vk.bin e5e5bc6c0b12d828d3b3258b73ccfdda26cfbc4b0fa1a3ccb3ffb73ed7bd1f73
EOF
}


verify() {
  local dir="$1" fail=0 name want got
  while read -r name want; do
    [[ -z "$name" ]] && continue
    if [[ ! -f "$dir/$name" ]]; then
      echo "MISSING   $name" >&2
      fail=1
      continue
    fi
    got="$(sha256sum "$dir/$name" | cut -d' ' -f1)"
    if [[ "$got" == "$want" ]]; then
      echo "OK        $name sha256=$got"
    else
      echo "DIVERGE   $name expected=$want got=$got" >&2
      fail=1
    fi
  done < <(expected)
  return $fail
}

if [[ "${1:-}" == "--self-test" ]]; then
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  cp -r "$root/wasm/." "$work/"

  echo "-- intact: must pass --"
  if ! verify "$work"; then
    echo "self-test FAILED: the intact directory did not pass" >&2
    exit 1
  fi


  flip() {
    local target="$1" size
    size="$(wc -c < "$target")"
    printf '\xff' | dd of="$target" bs=1 seek=$((size - 1)) count=1 conv=notrunc status=none
  }

  echo ""
  echo "-- one flipped byte in a WASM: must fail --"
  flip "$work/confidential_auditor.wasm"
  if verify "$work"; then
    echo "self-test FAILED: a flipped byte in a WASM was NOT detected" >&2
    exit 1
  fi
  cp "$root/wasm/confidential_auditor.wasm" "$work/"



  echo ""
  echo "-- one flipped byte in a VK: must fail --"
  flip "$work/vks/set_spender.vk.bin"
  if verify "$work"; then
    echo "self-test FAILED: a flipped byte in a VK was NOT detected" >&2
    exit 1
  fi

  echo ""
  echo "self-test OK: passes on the intact set and catches a flipped byte in a WASM and in a VK"
  exit 0
fi

echo "-- pinned third-party WASMs --"
verify "$root/wasm"
echo ""
echo "OK: the four WASMs and the six token VKs match wasm/PROVENANCE.md"
