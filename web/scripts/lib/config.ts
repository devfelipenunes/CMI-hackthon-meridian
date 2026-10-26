import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { parseConfig, type NetworkConfig } from "../../app/src/config/schema.js";
import { appConfigPath } from "./paths.js";
import type { Deployment } from "./deployment.js";

const HORIZON = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";
const SECONDS_PER_LEDGER = 5;

export function readConfig(path = appConfigPath): NetworkConfig | null {
  if (!existsSync(path)) return null;
  try {
    return parseConfig(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch {
    return null;
  }
}

/**
 * O `app/public/config/testnet.json`. Tudo que o app precisa vem do deploy, menos o
 * `register_data` (F-03), que é preservado enquanto o token for o mesmo.
 *
 * Se o token mudou, o `register_data` antigo não vale mais (a prova amarra o token, D-02):
 * voltamos para `null` e quem cria mercado fica bloqueado até rodar `pnpm register-data`.
 */
export function buildNetworkConfig(dep: Deployment, existing: NetworkConfig | null): NetworkConfig {
  const sameToken = existing !== null && existing.contracts.token === dep.contracts.token;

  return parseConfig({
    network: "testnet",
    rpcUrl: dep.rpc_url,
    horizonUrl: existing?.horizonUrl ?? HORIZON,
    friendbotUrl: existing?.friendbotUrl ?? FRIENDBOT,
    passphrase: dep.passphrase,
    deployedAtLedger: dep.deployed_at_ledger,
    finalizationGraceLedgers: dep.finalization_grace_ledgers,
    secondsPerLedger: existing?.secondsPerLedger ?? SECONDS_PER_LEDGER,
    contracts: {
      factory: dep.contracts.factory,
      token: dep.contracts.token,
      auditor: dep.contracts.auditor,
      underlying: dep.contracts.underlying,
    },
    auctionWasmHash: dep.auction_wasm_hash,
    registerData: sameToken ? (existing.registerData ?? null) : null,
    operatorKeyId: sameToken ? (existing.operatorKeyId ?? null) : null,
    envelopeKeyIsTestConstant: existing?.envelopeKeyIsTestConstant ?? true,
  });
}

export function writeConfig(config: NetworkConfig, path = appConfigPath): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

/** Grava só os dois campos do operador, sem tocar no resto da config. */
export function writeOperatorConfig(registerData: string, operatorKeyId: string, path = appConfigPath): void {
  const current = readConfig(path);
  if (current === null) throw new Error(`config ausente ou inválida em ${path}: rode \`pnpm sync:deployment\` antes`);
  writeConfig({ ...current, registerData, operatorKeyId }, path);
}
