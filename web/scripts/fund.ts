#!/usr/bin/env tsx
/**
 * Passo 1.3 (F-13): contas na testnet pelo friendbot.
 *
 *   pnpm fund --to G... [G...]    financia contas existentes ou novas
 *   pnpm fund --secret S...       financia a conta de uma chave
 *   pnpm fund                     cria uma carteira de desenvolvimento e a financia
 *
 * Uma carteira gerada aqui fica em .local/dev-wallets.json (0600). Nenhuma chave é impressa.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { Keypair } from "@stellar/stellar-sdk";

import { UsageError, done, fail, parseArgs, step } from "./lib/cli.js";
import { fund, horizonAccount, type ClassicNetwork } from "./lib/classic.js";
import { readConfig } from "./lib/config.js";
import { ensureLocalDir, localDir } from "./lib/paths.js";
import { join } from "node:path";

const USAGE = `uso: pnpm fund [--to G…[,G…]] [--secret S…]

  --to <G…>       financia a conta (vírgulas separam várias)
  --secret <S…>   financia a conta desta chave (prefira CMI_HOLDER_SECRET no ambiente:
                  o pnpm imprime os argumentos do script)
  sem --to        gera uma carteira de desenvolvimento em .local/dev-wallets.json`;

const ACCOUNT = /^G[A-Z2-7]{55}$/;
const SECRET = /^S[A-Z2-7]{55}$/;
const devWalletsPath = join(localDir, "dev-wallets.json");

interface DevWallet {
  publicKey: string;
  secret: string;
}

interface DevWalletsFile {
  wallets: DevWallet[];
}

function saveDevWallet(secret: string, publicKey: string): void {
  const file: DevWalletsFile = existsSync(devWalletsPath)
    ? (JSON.parse(readFileSync(devWalletsPath, "utf8")) as DevWalletsFile)
    : { wallets: [] };
  file.wallets.push({ publicKey, secret });
  ensureLocalDir();
  writeFileSync(devWalletsPath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), ["to", "secret"]);
  if (args.flags.has("help")) {
    console.log(USAGE);
    return;
  }
  if (args.positional.length > 0) throw new UsageError(`use --to para endereços (recebi ${args.positional[0]})`);
  for (const flag of args.flags) throw new UsageError(`opção desconhecida: --${flag}`);

  const config = readConfig();
  if (config === null) fail("config ausente ou inválida: rode `pnpm sync:deployment` primeiro");
  const network: ClassicNetwork = {
    horizonUrl: config.horizonUrl,
    friendbotUrl: config.friendbotUrl,
    rpcUrl: config.rpcUrl,
    passphrase: config.passphrase,
  };

  const targets: string[] = [];
  const to = args.values.get("to");
  if (to !== undefined) {
    for (const part of to.split(",")) {
      const address = part.trim();
      if (address.length === 0) continue;
      if (!ACCOUNT.test(address)) fail(`endereço inválido: ${address}`);
      targets.push(address);
    }
    if (targets.length === 0) fail("--to está vazio");
  }

  const secretRaw = (args.values.get("secret") ?? process.env.CMI_HOLDER_SECRET ?? "").trim();
  const secret = secretRaw.length === 0 ? undefined : secretRaw;
  if (secret !== undefined) {
    if (!SECRET.test(secret)) fail("a chave não é uma chave secreta Stellar (S…)");
    targets.push(Keypair.fromSecret(secret).publicKey());
  }

  if (targets.length === 0 && secret === undefined) {
    step("gerando uma carteira de desenvolvimento");
    const kp = Keypair.random();
    targets.push(kp.publicKey());
    saveDevWallet(kp.secret(), kp.publicKey());
    console.log(`  carteira ${kp.publicKey()}`);
    console.log(`  chave em ${devWalletsPath} (0600) — não foi impressa`);
  }

  for (const address of targets) await fund(network, address);

  for (const address of targets) {
    const account = await horizonAccount(network, address);
    const native = account?.balances.find((b) => b.asset_type === "native");
    console.log(`  ${address}  ${native?.balance ?? "—"} XLM`);
  }
  done("contas financiadas na testnet");
}

main().catch((error: unknown) => {
  console.error(`erro: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
