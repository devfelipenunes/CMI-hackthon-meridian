#!/usr/bin/env bash













set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"


VK_BYTES=1760



circuits() {
  local f
  for f in "$root"/circuits/*/src/main.nr; do
    [[ -f "$f" ]] || continue
    basename "$(dirname "$(dirname "$f")")"
  done
}





verify() {
  local dir="$1" fail=0 name vk size

  if [[ ! -f "$dir/SHA256SUMS" ]]; then
    echo "MISSING   SHA256SUMS" >&2
    fail=1
  fi

  while read -r name; do
    [[ -z "$name" ]] && continue

    if [[ ! -f "$dir/circuits/$name.json" ]]; then
      echo "MISSING   circuits/$name.json" >&2
      fail=1
    fi

    vk="$dir/vks/$name.vk.bin"
    if [[ ! -f "$vk" ]]; then
      echo "MISSING   vks/$name.vk.bin" >&2
      fail=1
      continue
    fi

    size="$(wc -c < "$vk")"
    if [[ "$size" -ne "$VK_BYTES" ]]; then
      echo "SIZE      vks/$name.vk.bin has $size bytes, expected $VK_BYTES" >&2
      fail=1
      continue
    fi

    echo "OK        $name vk=${size}B sha256=$(sha256sum "$vk" | cut -d' ' -f1)"
  done < <(circuits)



  if [[ -f "$dir/SHA256SUMS" ]] && ! (cd "$dir" && sha256sum --check --quiet SHA256SUMS); then
    (cd "$dir" && sha256sum --check SHA256SUMS >&2) || true
    fail=1
  fi

  return $fail
}

if [[ "${1:-}" == "--self-test" ]]; then
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  cp -r "$root/artifacts/." "$work/"

  echo "-- intact: must pass --"
  if ! verify "$work"; then
    echo "self-test FAILED: the intact directory did not pass" >&2
    exit 1
  fi

  echo ""
  echo "-- one flipped byte in the VK: must fail --"






  mapfile -t circuit_names < <(circuits)
  name="${circuit_names[0]}"
  target="$work/vks/$name.vk.bin"
  size="$(wc -c < "$target")"
  printf '\xff' | dd of="$target" bs=1 seek=$((size - 1)) count=1 conv=notrunc status=none

  if verify "$work"; then
    echo "self-test FAILED: a flipped byte was NOT detected" >&2
    exit 1
  fi

  echo ""
  echo "-- a VK with the wrong length: must fail --"
  cp "$root/artifacts/vks/$name.vk.bin" "$work/vks/$name.vk.bin"
  printf '\x00\x00\x00\x00' >> "$work/vks/$name.vk.bin"

  if verify "$work"; then
    echo "self-test FAILED: a VK with a trailer was NOT detected" >&2
    exit 1
  fi

  echo ""
  echo "self-test OK: passes on the intact set, catches the flipped byte and the wrong length"
  exit 0
fi

echo "-- circuits and VKs --"
verify "$root/artifacts"
echo ""
echo "OK: the circuits and VKs match artifacts/SHA256SUMS"
