#!/usr/bin/env bash











set -euo pipefail

export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"




cd "$root"

expected_nargo="1.0.0-beta.9"
expected_bb="0.87.0"

version_of() {
  "$1" --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?' | head -1
}



circuits() {
  local f
  for f in "$root"/circuits/*/src/main.nr; do
    [[ -f "$f" ]] || continue
    basename "$(dirname "$(dirname "$f")")"
  done
}

# nargo's JSON embeds the absolute path of each .nr in `file_map`. Without this, the
# artifacts change from one machine to another and `--check` reports DIVERGE on a correct
# checkout. Writes the paths relative to `circuits/`.
normalize_paths() {
  local file="$1" tmp="$1.tmp" prefix="$root/circuits/"
  jq -c --arg p "$prefix" \
    '.file_map |= with_entries(.value.path |= (if startswith($p) then .[($p | length):] else . end))' \
    "$file" > "$tmp"
  mv "$tmp" "$file"
}





build() {
  local out="$1" name json scratch="$root/circuits/target/vk-out"

  mkdir -p "$out/circuits" "$out/vks"
  ( cd "$root/circuits" && nargo compile --silence-warnings )

  while read -r name; do
    [[ -z "$name" ]] && continue
    json="$root/circuits/target/$name.json"

    if [[ ! -f "$json" ]]; then
      echo "nargo did not generate $json - does circuit $name have a main?" >&2
      exit 1
    fi
    cp "$json" "$out/circuits/$name.json"
    normalize_paths "$out/circuits/$name.json"

    echo ""
    echo "== $name =="
    bb gates --scheme ultra_honk -b "$json" | grep -E '"acir_opcodes"|"circuit_size"'








    scratch_dir="$scratch/$name"
    rm -rf "$scratch_dir"
    mkdir -p "$scratch_dir"
    bb write_vk --scheme ultra_honk --oracle_hash keccak \
      -b "$json" -o "$scratch_dir" --output_format bytes >/dev/null
    cp "$scratch_dir/vk" "$out/vks/$name.vk.bin"
    rm -rf "$scratch_dir"
  done < <(circuits)

  rm -rf "$scratch"



  ( cd "$out" && sha256sum circuits/*.json vks/*.vk.bin > SHA256SUMS )
}

actual_nargo="$(version_of nargo || true)"
actual_bb="$(version_of bb || true)"

fail=0
if [[ "$actual_nargo" != "$expected_nargo" ]]; then
  echo "nargo: expected $expected_nargo, found ${actual_nargo:-none}" >&2
  fail=1
fi
if [[ "$actual_bb" != "$expected_bb" ]]; then
  echo "bb: expected $expected_bb, found ${actual_bb:-none}" >&2
  fail=1
fi
command -v jq >/dev/null || {
  echo "jq: required to normalize artifact paths" >&2
  fail=1
}
if [[ $fail -ne 0 ]]; then
  exit 1
fi
echo "nargo $actual_nargo · bb $actual_bb · jq $(jq --version | sed 's/^jq-//')"

if [[ "${1:-}" == "--check" ]]; then



  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  build "$tmp"

  echo ""
  if ! diff -u "$root/artifacts/SHA256SUMS" "$tmp/SHA256SUMS"; then
    echo "" >&2
    echo "DIVERGE: run ./scripts/circuits.sh and version the result" >&2
    exit 1
  fi
  echo "OK: the versioned artifacts are the ones this circuit generates"
else
  echo ""
  build "$root/artifacts"
fi



echo ""
"$root/scripts/check-vks.sh"
