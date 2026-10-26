#!/usr/bin/env bash
# Usage: scripts/deploy-testnet.sh --network <quickstart|testnet> [options]
#
# Deploys the contracts, the verifiers and the Confidential Token to a network and
# writes deployments/<network>.json.
#
# Options:
#   --network quickstart|testnet   Target network (required).
#   --identity NAME                Stellar identity that signs (default: admin).
#   --auditor-key KEY              Auditor key for the token registration.
#   --fee-wallet ADDRESS           Fee wallet address.
#   --finalization-grace N         Finalization grace in ledgers, [12, 34560] (default: 34560).
#   --check-deployment             Only re-check an existing deployment.
#   --self-test                    Run the script's self-test.
#   --no-build                     Skip the WASM build.
#   -h, --help                     Show this help.
#
# Pre-requisites: stellar, jq, sha256sum and curl.
#
# Example:
#   ./scripts/deploy-testnet.sh --network quickstart --finalization-grace 30

set -euo pipefail

export PATH="$HOME/.nargo/bin:$HOME/.bb:$PATH"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"





network=""
identity="admin"
auditor_key=""
fee_wallet=""
finalization_grace=34560
check_only=false
self_test=false
no_build=false

net_setup() {
  case "$1" in
    quickstart)
      rpc_url="http://localhost:8000/soroban/rpc"
      passphrase="Standalone Network ; February 2017"
      friendbot="http://localhost:8000/friendbot"
      ;;
    testnet)
      rpc_url="https://soroban-testnet.stellar.org"
      passphrase="Test SDF Network ; September 2015"
      friendbot="https://friendbot.stellar.org"
      ;;
    *)
      echo "unknown network: $1 (use quickstart or testnet)" >&2
      exit 2
      ;;
  esac



  json="$root/deployments/$1.json"
}

usage() {
  awk 'NR>1 && /^#/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' "${BASH_SOURCE[0]}"
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --network) network="${2:-}"; shift 2 ;;
    --identity) identity="${2:-}"; shift 2 ;;
    --auditor-key) auditor_key="${2:-}"; shift 2 ;;
    --fee-wallet) fee_wallet="${2:-}"; shift 2 ;;
    --finalization-grace) finalization_grace="${2:-}"; shift 2 ;;
    --check-deployment) check_only=true; shift ;;
    --self-test) self_test=true; shift ;;
    --no-build) no_build=true; shift ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done





die() { echo "$*" >&2; exit 1; }



[[ "$finalization_grace" =~ ^[0-9]+$ && "$finalization_grace" -ge 12 && "$finalization_grace" -le 34560 ]] ||
  die "--finalization-grace out of [12, 34560]: $finalization_grace"
say() { echo "  $*"; }

require_tools() {
  local t
  for t in stellar jq sha256sum curl; do
    command -v "$t" >/dev/null || die "missing $t"
  done
}






sx() {
  local args=() a sep=false
  for a in "$@"; do
    if [[ "$a" == "--" && "$sep" == false ]]; then
      args+=(--rpc-url "$rpc_url" --network-passphrase "$passphrase")
      sep=true
    fi
    args+=("$a")
  done
  if [[ "$sep" == false ]]; then
    args+=(--rpc-url "$rpc_url" --network-passphrase "$passphrase")
  fi
  stellar "${args[@]}"
}



read_call() {
  local id="$1" fn="$2"; shift 2
  sx contract invoke --id "$id" --source "$identity" --send no -- "$fn" "$@"
}






admin_address() { stellar keys address "$identity" 2>/dev/null; }








last_line() { awk 'NF { last = $0 } END { print last }'; }

deploy_wasm() {
  local wasm="$1"; shift
  local out id
  out="$(sx contract deploy --wasm "$wasm" --source "$identity" --optimize=false "$@")" || {
    echo "$out" >&2
    die "deploy of $wasm failed"
  }
  id="$(printf '%s\n' "$out" | last_line)"
  [[ "$id" == C* && ${#id} -eq 56 ]] || die "could not parse the deploy output for $wasm: $id"
  printf '%s' "$id"
}

upload_wasm() {
  local wasm="$1" out hash
  out="$(sx contract upload --wasm "$wasm" --source "$identity")" || {
    echo "$out" >&2
    die "upload of $wasm failed"
  }
  hash="$(printf '%s\n' "$out" | last_line)"
  [[ "$hash" =~ ^[0-9a-f]{64}$ ]] || die "could not parse the upload output for $wasm: $hash"
  printf '%s' "$hash"
}








ours() {
  local f
  case "$1" in
    auction) f="wasm/auction.wasm" ;;
    *) f="target/wasm32v1-none/release/$1.wasm" ;;
  esac
  [[ -f "$f" ]] || die "missing $f - run ./scripts/build.sh"
  printf '%s' "$f"
}

build_if_needed() {
  if [[ "$no_build" == true ]]; then
    ours auction >/dev/null
    ours factory >/dev/null
    return
  fi
  echo "-- building the contracts --"
  ./scripts/build.sh >/dev/null
}







VK_CIRCUITS=(register withdraw transfer spender_transfer set_spender revoke_spender)

deploy_all() {
  local net="$1"
  net_setup "$net"
  require_tools



  if [[ -f "$json" ]]; then
    echo "-- $json already exists: checking, no redeploy --"
    check_deployment "$json" "$auditor_key" "$root/wasm/vks"
    return
  fi

  build_if_needed

  local admin
  admin="$(admin_address)" || die "identity '$identity' does not exist (stellar keys generate $identity)"




  if [[ "$net" == quickstart ]]; then
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' "$friendbot?addr=$admin")"
    [[ "$code" == 2* || "$code" == 4* ]] || die "friendbot responded $code for $admin"
    say "identity $identity = $admin (funded on quickstart)"
  fi

  echo "-- native SAC (XLM) --"

  sx contract asset deploy --asset native --source "$identity" >/dev/null 2>&1 || true
  local underlying
  underlying="$(sx contract id asset --asset native)"
  say "underlying = $underlying"

  echo "-- token verifier and auditor --"
  local verifier auditor token
  verifier="$(deploy_wasm wasm/confidential_verifier.wasm -- --admin "$admin" --manager "$admin")"
  say "verifier = $verifier"
  auditor="$(deploy_wasm wasm/confidential_auditor.wasm -- --admin "$admin" --manager "$admin")"
  say "auditor  = $auditor"

  echo "-- token --"
  token="$(deploy_wasm wasm/confidential_token.wasm -- \
    --underlying_asset "$underlying" --verifier "$verifier" --auditor "$auditor")"
  say "token    = $token"

  echo "-- the six VKs --"
  local name n out
  n=0
  for name in "${VK_CIRCUITS[@]}"; do
    local vk="wasm/vks/$name.vk.bin"
    [[ -f "$vk" ]] || die "missing $vk"


    if ! out="$(sx contract invoke --id "$verifier" --source "$identity" --send yes -- \
        register_verification_key \
        --circuit_type "$n" --vk-file-path "$vk" --operator "$admin" 2>&1)"; then
      printf '%s\n' "$out" >&2
      die "registration of VK $name failed (circuit_type $n)"
    fi
    say "$name (circuit_type $n, $(wc -c < "$vk")B)"
    n=$((n + 1))
  done



  echo "-- auditor key (id 0) --"
  local key_file
  key_file="$(mktemp)"
  printf '%s' "$auditor_key" | xxd -r -p > "$key_file"

  if ! out="$(sx contract invoke --id "$auditor" --source "$identity" --send yes -- \
      register_key --auditor_id 0 --point-file-path "$key_file" --operator "$admin" 2>&1)"; then
    printf '%s\n' "$out" >&2
    rm -f "$key_file"
    die "the auditor rejected the key; it must be a valid Grumpkin point (128 hex)"
  fi
  rm -f "$key_file"
  say "key = ${auditor_key:0:16}... (128 hex)"





  echo "-- UltraHonk verifiers --"
  local bid_v allocation_v settlement_v
  bid_v="$(deploy_wasm wasm/ultrahonk_verifier.wasm -- \
    --vk_bytes-file-path artifacts/vks/bid_validity.vk.bin)"
  say "bid_verifier        = $bid_v (bid_validity.vk.bin)"
  allocation_v="$(deploy_wasm wasm/ultrahonk_verifier.wasm -- \
    --vk_bytes-file-path artifacts/vks/winner_allocation.vk.bin)"
  say "allocation_verifier = $allocation_v (winner_allocation.vk.bin)"
  settlement_v="$(deploy_wasm wasm/ultrahonk_verifier.wasm -- \
    --vk_bytes-file-path artifacts/vks/settlement_binding.vk.bin)"
  say "settlement_verifier = $settlement_v (settlement_binding.vk.bin)"

  echo "-- Auction and Factory --"
  local auction_wasm factory_wasm auction_hash factory
  auction_wasm="$(ours auction)"
  factory_wasm="$(ours factory)"
  auction_hash="$(upload_wasm "$auction_wasm")"
  say "auction hash = $auction_hash"




  say "finalization_grace_ledgers = $finalization_grace"
  factory="$(deploy_wasm "$factory_wasm" -- \
    --admin "$admin" \
    --auction_wasm_hash "$auction_hash" \
    --platform "{\"collateral_token\":\"$token\",\"fee_asset\":\"$underlying\",\"bid_verifier\":\"$bid_v\",\"allocation_verifier\":\"$allocation_v\",\"settlement_verifier\":\"$settlement_v\",\"fee_wallet\":\"$fee_wallet\",\"auditor_id\":0,\"finalization_grace_ledgers\":$finalization_grace}")"
  say "factory = $factory"

  echo "-- writing $json --"
  local ledger
  ledger="$(curl -s -X POST "$rpc_url" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' |
    jq -r '.result.sequence // empty')"

  mkdir -p "$(dirname "$json")"
  jq -n \
    --arg net "$net" --arg rpc "$rpc_url" --arg pass "$passphrase" \
    --arg identity "$identity" --arg admin "$admin" \
    --argjson ledger "${ledger:-0}" \
    --arg underlying "$underlying" --arg verifier "$verifier" --arg auditor "$auditor" \
    --arg token "$token" \
    --arg bid_v "$bid_v" --arg allocation_v "$allocation_v" --arg settlement_v "$settlement_v" \
    --arg factory "$factory" --arg auction_hash "$auction_hash" \
    --arg auditor_key "$auditor_key" --arg fee_wallet "$fee_wallet" \
    --argjson grace "$finalization_grace" \
    --arg token_sha "$(sha256sum wasm/confidential_token.wasm | cut -d' ' -f1)" \
    --arg verifier_sha "$(sha256sum wasm/confidential_verifier.wasm | cut -d' ' -f1)" \
    --arg auditor_sha "$(sha256sum wasm/confidential_auditor.wasm | cut -d' ' -f1)" \
    --arg ultra_sha "$(sha256sum wasm/ultrahonk_verifier.wasm | cut -d' ' -f1)" \
    --arg auction_sha "$(sha256sum "$auction_wasm" | cut -d' ' -f1)" \
    --arg factory_sha "$(sha256sum "$factory_wasm" | cut -d' ' -f1)" \
    --argjson vks "$(vk_manifest "$root/wasm/vks")" \
    '{
      network: $net, rpc_url: $rpc, passphrase: $pass,
      identity: $identity, admin: $admin, deployed_at_ledger: $ledger,
      contracts: {
        underlying: $underlying, verifier: $verifier, auditor: $auditor, token: $token,
        bid_verifier: $bid_v, allocation_verifier: $allocation_v,
        settlement_verifier: $settlement_v, factory: $factory
      },
      auction_wasm_hash: $auction_hash,
      auditor: { id: 0, key: $auditor_key },
      fee_wallet: $fee_wallet,
      finalization_grace_ledgers: $grace,
      wasm_sha256: {
        confidential_token: $token_sha, confidential_verifier: $verifier_sha,
        confidential_auditor: $auditor_sha, ultrahonk_verifier: $ultra_sha,
        auction: $auction_sha, factory: $factory_sha
      },
      token_vks: $vks,
      pending: [
        "fee_wallet: not yet a confidential account (D22). Until it is, the create_market of the Factory rejects every market with FeeWalletNotRegistered (RF-01): register the account on the token and update it with set_platform_config"
      ]
    }' > "$json"

  echo ""
  echo "OK: $json"
}

vk_manifest() {
  local dir="$1" name out="{}"
  for name in "${VK_CIRCUITS[@]}"; do
    out="$(jq -c --arg n "$name" --arg h "$(sha256sum "$dir/$name.vk.bin" | cut -d' ' -f1)" \
      '. + {($n): $h}' <<<"$out")"
  done
  printf '%s' "$out"
}





read_json() { jq -r "$2" "$1"; }





check_deployment() {
  local file="$1" want_key="$2" vks_dir="$3"
  local fail=0 id name want got

  echo "-- WASMs on-chain --"




  while read -r name id local_file; do
    [[ -z "$name" ]] && continue
    local tmp
    tmp="$(mktemp)"
    if ! stellar contract fetch --id "$id" --out-file "$tmp" \
        --rpc-url "$rpc_url" --network-passphrase "$passphrase" >/dev/null 2>&1; then
      echo "FAILED    $name ($id): could not fetch the wasm" >&2
      fail=1
      rm -f "$tmp"
      continue
    fi
    got="$(sha256sum "$tmp" | cut -d' ' -f1)"
    rm -f "$tmp"
    if [[ "$name" == factory ]]; then
      want="$(read_json "$file" .wasm_sha256.factory)"
      if [[ -f "$local_file" && "$(sha256sum "$local_file" | cut -d' ' -f1)" != "$want" ]]; then
        echo "WARNING   factory: the local build is not the deployed one (did the code change after deploy?)"
      fi
    elif [[ -f "$local_file" ]]; then
      want="$(sha256sum "$local_file" | cut -d' ' -f1)"
    else
      want="$(read_json "$file" ".wasm_sha256.$name")"
      echo "WARNING   $name: no $local_file; checking against the deploy's own sha256"
    fi
    if [[ "$got" == "$want" ]]; then
      echo "OK        $name $got"
    else
      echo "DIVERGE   $name on-chain=$got expected=$want" >&2
      fail=1
    fi
  done <<EOF
$(wasm_pairs "$file")
EOF




  echo ""
  echo "-- Auction WASM (by the hash the Factory uses) --"
  local auction_hash auction_tmp
  auction_hash="$(read_json "$file" .auction_wasm_hash)"
  auction_tmp="$(mktemp)"
  if ! stellar contract fetch --wasm-hash "$auction_hash" --out-file "$auction_tmp" \
      --rpc-url "$rpc_url" --network-passphrase "$passphrase" >/dev/null 2>&1; then
    echo "FAILED    auction: code $auction_hash is not installed on the network" >&2
    fail=1
  else
    got="$(sha256sum "$auction_tmp" | cut -d' ' -f1)"
    want="$(read_json "$file" .wasm_sha256.auction)"
    if [[ "$got" == "$auction_hash" && "$got" == "$want" ]]; then
      echo "OK        auction $got"
    else
      echo "DIVERGE   auction on-chain=$got hash=$auction_hash deploy=$want" >&2
      fail=1
    fi
    if [[ "$(sha256sum wasm/auction.wasm | cut -d' ' -f1)" != "$got" ]]; then
      echo "WARNING   auction: wasm/auction.wasm changed after deploy (new markets still use the deployed one)"
    fi
  fi
  rm -f "$auction_tmp"




  echo ""
  echo "-- the six token VKs --"
  local verifier
  verifier="$(read_json "$file" .contracts.verifier)"
  local n=0 vk_tmp
  vk_tmp="$(mktemp)"
  for name in "${VK_CIRCUITS[@]}"; do
    local hex
    hex="$(read_call "$verifier" get_verification_key --circuit_type "$n" 2>/dev/null | last_line | tr -d '"')"
    if [[ -z "$hex" || "$hex" == "null" ]]; then
      echo "FAILED    $name (circuit_type $n): the verifier did not return a VK" >&2
      fail=1
      n=$((n + 1))
      continue
    fi
    printf '%s' "$hex" | xxd -r -p > "$vk_tmp"
    got="$(sha256sum "$vk_tmp" | cut -d' ' -f1)"
    if [[ -f "$vks_dir/$name.vk.bin" ]]; then
      want="$(sha256sum "$vks_dir/$name.vk.bin" | cut -d' ' -f1)"
    else
      want="$(read_json "$file" ".token_vks.$name")"
    fi
    if [[ "$got" == "$want" ]]; then
      echo "OK        $name $got"
    else
      echo "DIVERGE   $name on-chain=$got local=$want" >&2
      fail=1
    fi
    n=$((n + 1))
  done
  rm -f "$vk_tmp"


  echo ""
  echo "-- auditor key --"
  got="$(read_call "$(read_json "$file" .contracts.auditor)" get_key --auditor_id 0 2>/dev/null |
    last_line | tr -d '"' | tr 'A-F' 'a-f')"
  if [[ "$got" == "$(printf '%s' "$want_key" | tr 'A-F' 'a-f')" ]]; then
    echo "OK        auditor id 0 = ${got:0:16}..."
  else
    echo "DIVERGE   auditor id 0 on-chain=${got:0:16}... expected=${want_key:0:16}..." >&2
    fail=1
  fi






  echo ""
  echo "-- UltraHonk verifiers (versioned fixtures) --"
  local pair key circuit case proof inputs vid
  for pair in bid_verifier:bid_validity/valid_ana allocation_verifier:winner_allocation/poc4_8bids \
      settlement_verifier:settlement_binding/partial; do
    key="${pair%%:*}"
    circuit="${pair#*:}"
    case="${circuit#*/}"
    circuit="${circuit%%/*}"
    proof="artifacts/fixtures/$circuit/$case/proof"
    inputs="artifacts/fixtures/$circuit/$case/public_inputs"
    vid="$(read_json "$file" ".contracts.$key")"
    if [[ ! -f "$proof" || ! -f "$inputs" ]]; then
      echo "WARNING   no fixtures for $circuit; run ./scripts/fixtures.sh to check the VK for $key"
    elif sx contract invoke --id "$vid" --source "$identity" --send yes -- verify_proof \
        --public_inputs-file-path "$inputs" --proof_bytes-file-path "$proof" >/dev/null 2>&1; then
      echo "OK        $key accepted the proof from artifacts/fixtures/$circuit/$case"
    else
      echo "DIVERGE   $key rejected the versioned proof: the on-chain VK is not the one in artifacts/vks/$circuit.vk.bin" >&2
      fail=1
    fi
  done



  echo ""
  echo "-- Factory PlatformConfig --"
  local factory platform
  factory="$(read_json "$file" .contracts.factory)"

  platform="$(read_call "$factory" get_platform_config 2>/dev/null | last_line | jq -S . 2>/dev/null || true)"
  if [[ -n "$platform" ]]; then
    local expect
    expect="$(jq -S -c '{
      collateral_token: .contracts.token, fee_asset: .contracts.underlying,
      bid_verifier: .contracts.bid_verifier, allocation_verifier: .contracts.allocation_verifier,
      settlement_verifier: .contracts.settlement_verifier, fee_wallet: .fee_wallet, auditor_id: 0,
      finalization_grace_ledgers: .finalization_grace_ledgers
    }' "$file")"
    if [[ "$(jq -S -c . <<<"$platform")" == "$expect" ]]; then
      echo "OK        the 8 fields match the deploy"
    else
      echo "DIVERGE   on-chain=$(jq -S -c . <<<"$platform")" >&2
      echo "          deploy =$expect" >&2
      fail=1
    fi
  else
    echo "FAILED    could not read get_platform_config from the Factory" >&2
    fail=1
  fi


  local grace
  grace="$(read_json "$file" .finalization_grace_ledgers)"
  echo ""
  echo "-- finalization grace period (ADR-027) --"
  if [[ "$network" != quickstart && "$grace" -lt 34560 ]]; then
    echo "WARNING   finalization_grace_ledgers = $grace (< 34560, 2 days): test network only"
  else
    echo "OK        finalization_grace_ledgers = $grace"
  fi




  echo ""
  echo "-- fee wallet account on the token --"
  local fee_wallet_addr
  fee_wallet_addr="$(read_json "$file" .fee_wallet)"



  local balance_out balance_ok=false
  if balance_out="$(read_call "$(read_json "$file" .contracts.token)" confidential_balance \
      --account "$fee_wallet_addr" 2>&1)"; then
    balance_ok=true
  fi
  if grep -q 'Error(Contract, #3501)' <<<"$balance_out"; then
    echo "WARNING   fee wallet $fee_wallet_addr has no account on the token: create_market refuses until it is registered and configured (set_platform_config)"
  elif [[ "$balance_ok" == true ]] || grep -q "doesn't have a matching Udt" <<<"$balance_out"; then
    echo "OK        fee wallet $fee_wallet_addr has an account on the token"
  else
    echo "FAILED    could not read the fee wallet account on the token" >&2
    fail=1
  fi

  echo ""
  if [[ "$fail" -ne 0 ]]; then
    echo "check-deployment FAILED" >&2
    return 1
  fi
  echo "OK: what is on the network is what this repository describes"
}


wasm_pairs() {
  local file="$1"
  jq -r '.contracts | to_entries[] |
    select(.key | test("^(underlying)$") | not) |
    "\(.key) \(.value) \(
      if .key == "verifier" then "wasm/confidential_verifier.wasm"
      elif .key == "auditor" then "wasm/confidential_auditor.wasm"
      elif .key == "token" then "wasm/confidential_token.wasm"
      elif .key | test("_verifier$") then "wasm/ultrahonk_verifier.wasm"
      elif .key == "factory" then "target/wasm32v1-none/release/factory.wasm"
      else "" end)"' "$file"
}





self_test() {
  echo "== 3.3: test battery against the local quickstart =="

  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT



  echo ""
  echo "-- a full deploy on quickstart --"
  rm -f "$json"
  deploy_all quickstart
  [[ -f "$json" ]] || { echo "the deploy did not write $json" >&2; exit 1; }
  cp "$json" "$work/first.json"



  echo ""
  echo "-- run again: must check, not redeploy --"
  deploy_all quickstart
  if ! diff -u "$work/first.json" "$json" > "$work/idem.diff"; then
    echo "the second deploy changed the addresses:" >&2
    cat "$work/idem.diff" >&2
    exit 1
  fi
  echo "OK: the addresses are the same"



  echo ""
  echo "-- check-deployment on what was just deployed --"
  check_deployment "$json" "$auditor_key" "$root/wasm/vks"



  echo ""
  echo "-- counter-proof: the auditor check catches a different key --"
  trocada="$(flip_hex "$auditor_key")"
  if check_deployment "$json" "$trocada" "$root/wasm/vks" 2>/dev/null; then
    echo "the auditor check ACCEPTED a key different from the registered one" >&2
    exit 1
  fi
  echo "OK: rejected"

  echo ""
  echo "-- counter-proof: the VK check catches a flipped byte --"
  cp -r "$root/wasm/vks" "$work/vks"
  flip_file "$work/vks/set_spender.vk.bin"
  if check_deployment "$json" "$auditor_key" "$work/vks" 2>/dev/null; then
    echo "the VK check ACCEPTED a VK with a flipped byte" >&2
    exit 1
  fi
  echo "OK: rejected"

  echo ""
  echo "test battery 3.3 OK"
}


flip_hex() {
  local hex="$1" last="${1: -1}" novo
  case "$last" in
    f) novo=0 ;;
    *) novo=$((16#$last + 1)) ;;
  esac
  printf '%s%x' "${hex:0:${#hex}-1}" "$novo"
}


flip_file() {
  local target="$1" size
  size="$(wc -c < "$target")"
  printf '\xff' | dd of="$target" bs=1 seek=$((size - 1)) count=1 conv=notrunc status=none
}



main() {
  if [[ "$self_test" == true ]]; then
    [[ -n "$auditor_key" ]] || { echo "--self-test requires --auditor-key" >&2; exit 2; }

    net_setup quickstart
    fee_wallet="${fee_wallet:-$(stellar keys address "$identity")}"
    self_test
    return
  fi

  [[ -n "$network" ]] || usage
  net_setup "$network"

  if [[ "$check_only" == true ]]; then
    [[ -f "$json" ]] || { echo "there is no $json to check" >&2; exit 1; }
    check_deployment "$json" "${auditor_key:-$(read_json "$json" .auditor.key)}" "$root/wasm/vks"
  else
    [[ -n "$auditor_key" ]] || { echo "--auditor-key is required" >&2; exit 2; }


    if [[ "$network" == testnet && -z "$fee_wallet" ]]; then
      echo "--fee-wallet is required on testnet" >&2
      exit 2
    fi
    fee_wallet="${fee_wallet:-$(stellar keys address "$identity")}"
    deploy_all "$network"
  fi
}

main
