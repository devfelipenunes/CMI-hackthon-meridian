#!/usr/bin/env bash















set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
contracts="$root/contracts"
identity="${CMI_LOCAL_IDENTITY:-cmi-local-admin}"
grace="${CMI_FINALIZATION_GRACE_LEDGERS:-60}"
src="$contracts/deployments/quickstart.json"
out="$root/deployments/local.json"

die() { echo "$*" >&2; exit 1; }

for t in stellar jq curl pnpm; do
  command -v "$t" >/dev/null || die "falta o $t"
done
[[ -x "$contracts/scripts/deploy-testnet.sh" ]] || die "falta $contracts/scripts/deploy-testnet.sh (git submodule update --init)"
"$root/scripts/localnet.sh" status >/dev/null || die "a rede local não está no ar: ./scripts/localnet.sh up"


if ! stellar keys address "$identity" >/dev/null 2>&1; then
  echo "-- criando a identidade $identity (só para a rede local) --"
  stellar keys generate "$identity" >/dev/null
fi




if [[ ! -f "$contracts/target/wasm32v1-none/release/factory.wasm" ]]; then
  echo "-- build dos WASMs dos contratos (target/) --"
  (cd "$contracts" && stellar contract build >/dev/null)
fi

if [[ -f "$src" ]]; then


  (cd "$contracts" && ./scripts/deploy-testnet.sh --network quickstart --identity "$identity" --check-deployment)
else

  key="$(cd "$root/packages/testing" && pnpm -s exec tsx src/cli/local-auditor-key.ts)"
  [[ "$key" =~ ^[0-9a-f]{128}$ ]] || die "chave do auditor inválida: $key"
  (cd "$contracts" && ./scripts/deploy-testnet.sh --network quickstart --identity "$identity" --auditor-key "$key" --finalization-grace "$grace" --no-build)
fi

[[ -f "$src" ]] || die "o deploy dos contratos não escreveu $src"
mkdir -p "$(dirname "$out")"
cp "$src" "$out"




fee_wallet="$(jq -r .fee_wallet "$out")"
if [[ "$fee_wallet" == "$(stellar keys address "$identity")" ]]; then
  echo "-- fee wallet no Confidential Token --"
  (cd "$root/packages/testing" && CMI_ACCOUNT_SECRET="$(stellar keys show "$identity")" pnpm -s exec tsx src/cli/register-local-account.ts)
else
  echo "aviso: a fee_wallet $fee_wallet não é a identidade $identity; registre-a no token antes do primeiro create_market" >&2
fi
echo "ok: $out"
