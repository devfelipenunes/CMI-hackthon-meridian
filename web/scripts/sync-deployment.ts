#!/usr/bin/env tsx
/**
 * Passo 1.1 (F-06): deployments/testnet.json → app/public/config/testnet.json.
 *
 * Lê o deployment da `main` dos contratos (sem mudar o checkout), confere na testnet e só
 * então grava a config que o app carrega. Se o token mudou, o `register_data` antigo é
 * descartado — ele amarra o token (D-02) — e o script avisa para rodar `pnpm register-data`.
 */
import { CmiError } from "@zolvency-cmi/core";

import { UsageError, done, parseArgs, step, warn } from "./lib/cli.js";
import { appConfigPath } from "./lib/paths.js";
import { buildNetworkConfig, readConfig, writeConfig } from "./lib/config.js";
import { loadDeployment } from "./lib/deployment.js";
import { verifyDeployment } from "./lib/verify.js";

const USAGE = `uso: pnpm sync:deployment [--file <deployments/testnet.json>] [--check]

  --file <caminho>  usa um JSON de deploy local em vez de origin/main
  --check           confere e mostra o resultado, sem gravar a config`;

function errorMessage(error: unknown): string {
  if (error instanceof CmiError) return `[${error.code}] ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), ["file"]);
  if (args.flags.has("help")) {
    console.log(USAGE);
    return;
  }
  if (args.positional.length > 0) throw new UsageError(`argumento inesperado: ${args.positional[0]}`);
  for (const flag of args.flags) {
    if (flag !== "check") throw new UsageError(`opção desconhecida: --${flag}`);
  }

  const { deployment, source } = loadDeployment(args.values.get("file"));
  step(`deployment lido de ${source}`);
  if (deployment.pending.length > 0) warn(`o deployment tem ${deployment.pending.length} item(ns) pendente(s)`);

  const { platform, nextMarketId, latestLedger } = await verifyDeployment(deployment);

  const existing = readConfig();
  const config = buildNetworkConfig(deployment, existing);

  if (existing !== null && existing.contracts.token !== config.contracts.token) {
    warn("o token mudou: o register_data anterior foi descartado. Rode `pnpm register-data`.");
  }

  console.log("");
  console.log(`  rede            ${config.network} (ledger ${latestLedger})`);
  console.log(`  factory         ${config.contracts.factory}`);
  console.log(`  token           ${config.contracts.token}`);
  console.log(`  auditor         ${config.contracts.auditor} (id ${platform.auditorId})`);
  console.log(`  underlying      ${config.contracts.underlying}`);
  console.log(`  próximo mercado #${nextMarketId}`);
  console.log(`  carência        ${config.finalizationGraceLedgers} ledgers`);
  console.log(`  register_data   ${config.registerData === null ? "ausente (criação de mercado bloqueada)" : "presente"}`);
  console.log("");

  if (args.flags.has("check")) {
    done("config conferida; nada foi gravado (--check)");
    return;
  }

  writeConfig(config);
  done(`config gravada em ${appConfigPath}`);

  if (config.registerData === null) {
    warn("sem register_data, a criação de mercados fica bloqueada até `pnpm register-data`");
  }
}

main().catch((error: unknown) => {
  console.error(`erro: ${errorMessage(error)}`);
  process.exitCode = 1;
});
