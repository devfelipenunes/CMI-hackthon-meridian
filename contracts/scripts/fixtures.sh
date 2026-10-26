#!/usr/bin/env bash




























set -euo pipefail

export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"



cd "$root"




scheme=ultra_honk
oracle=keccak



scratch="circuits/target/fixtures-out"



work_tomls=()
cleanup() {
  rm -f "${work_tomls[@]}"
  rm -rf "$scratch"
}
trap cleanup EXIT

command -v jq >/dev/null || { echo "jq is missing (it reads context.json)" >&2; exit 1; }

check_size() {
  local file="$1" want="$2" got
  got="$(wc -c < "$file")"
  if [[ "$got" -ne "$want" ]]; then
    echo "$file has $got bytes, expected $want" >&2
    exit 1
  fi
}











build() {
  local circuit="$1" case_name="$2" proof_bytes="$3" public_inputs_bytes="$4"
  shift 4

  local case_dir="circuits/$circuit/fixtures/$case_name"
  local out_dir="artifacts/fixtures/$circuit/$case_name"
  local work_toml="circuits/$circuit/Prover.toml"
  local context="$case_dir/context.json"




  local has_context=0
  [[ -f "$context" ]] && has_context=1

  if [[ $# -gt 0 && $has_context -eq 0 ]]; then
    echo "missing $context" >&2
    echo "  -> run: cargo test --test fixtures_dump -- --ignored" >&2
    exit 1
  fi
  work_tomls+=("$work_toml")

  echo "== $circuit / $case_name =="


  local key expected value
  for key in "$@"; do
    expected="$(jq -r ".$key" "$context")"
    value="$(grep -oE "^$key = \"0x0*[0-9a-f]+\"" "$case_dir/Prover.toml" | grep -oE '0x[0-9a-f]+' || true)"
    if [[ -z "$value" ]]; then
      echo "the Prover.toml for $case_name has no \`$key\` in hexadecimal" >&2
      exit 1
    fi
    if [[ "$(printf '%d' "$value")" != "$expected" ]]; then
      echo "the scenario changed: $key in the context is $expected, and the fixture proves $((value))" >&2
      echo "  -> the fixture must be rederived (the witness depends on this value)" >&2
      exit 1
    fi
  done







  cp "$case_dir/Prover.toml" "$work_toml"

  if grep -q '^config_hash_lo' "$work_toml" && [[ $has_context -eq 0 ]]; then
    echo "the Prover.toml for $case_name stitches in config_hash and there is no $context" >&2
    exit 1
  fi

  if [[ $has_context -eq 1 ]]; then
    local config_hash_lo config_hash_hi
    config_hash_lo="$(jq -r .config_hash_lo "$context")"
    config_hash_hi="$(jq -r .config_hash_hi "$context")"
    echo "config_hash: $(jq -r .config_hash "$context")"


    sed -i -E "s|^config_hash_lo = .*|config_hash_lo = \"0x$config_hash_lo\"|" "$work_toml"
    sed -i -E "s|^config_hash_hi = .*|config_hash_hi = \"0x$config_hash_hi\"|" "$work_toml"

    grep -q "^config_hash_lo = \"0x$config_hash_lo\"$" "$work_toml" || {
      echo "could not replace config_hash_lo in the Prover.toml" >&2
      exit 1
    }
  fi



  ( cd "circuits/$circuit" && nargo compile --silence-warnings && nargo execute --package "$circuit" )

  local bytecode="circuits/target/$circuit.json"
  local witness="circuits/target/$circuit.gz"
  [[ -f "$bytecode" ]] || { echo "nargo did not generate $bytecode" >&2; exit 1; }
  [[ -f "$witness" ]] || { echo "nargo did not generate $witness" >&2; exit 1; }

  rm -rf "$scratch"
  mkdir -p "$scratch" "$out_dir"
  bb prove --scheme "$scheme" --oracle_hash "$oracle" \
    --bytecode_path "$bytecode" --witness_path "$witness" \
    --output_path "$scratch" --output_format bytes_and_fields >/dev/null




  cp "$scratch/proof" "$out_dir/proof"
  cp "$scratch/public_inputs" "$out_dir/public_inputs"

  check_size "$out_dir/proof" "$proof_bytes"
  check_size "$out_dir/public_inputs" "$public_inputs_bytes"






  bb verify --scheme "$scheme" --oracle_hash "$oracle" \
    -k "artifacts/vks/$circuit.vk.bin" -p "$out_dir/proof" -i "$out_dir/public_inputs" >/dev/null

  echo "OK   $out_dir/proof            $(sha256sum "$out_dir/proof" | cut -d' ' -f1)"
  echo "OK   $out_dir/public_inputs    $(sha256sum "$out_dir/public_inputs" | cut -d' ' -f1)"
  echo "OK: the fixture matches artifacts/vks/$circuit.vk.bin"
  echo ""
}


build bid_validity valid_ana 14592 480 \
  market_id participant_id requested_quantity min_price_per_quota



build winner_allocation poc4_8bids 14592 736 \
  market_id auction_rule bid_count total_supply
build winner_allocation undersubscribed 14592 736 \
  market_id auction_rule bid_count total_supply




build settlement_binding partial 14592 320
build settlement_binding full 14592 320
build settlement_binding zero 14592 320













for b in 0 1 2 3 4 5 6 7; do
  build bid_validity "poc4_b$b" 14592 480 \
    market_id participant_id requested_quantity min_price_per_quota
done
for b in 0 1 2; do
  build bid_validity "under_b$b" 14592 480 \
    market_id participant_id requested_quantity min_price_per_quota
done


poc4_filled=(200 150 300 250 300 0 0 0)
for b in 0 1 2 3 4 5 6 7; do
  build settlement_binding "poc4_b${b}_f${poc4_filled[$b]}" 14592 320

  if [[ "${poc4_filled[$b]}" -ne 0 ]]; then
    build settlement_binding "poc4_b${b}_f0" 14592 320
  fi
done


for spec in "under_b0_f200" "under_b1_f500" "under_b2_f300"; do
  build settlement_binding "$spec" 14592 320
done
