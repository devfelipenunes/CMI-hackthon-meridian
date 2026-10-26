

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Secret } from "@zolvency-cmi/core";

import { connectChain, connectProver } from "../chain/connect.js";
import { loadConfig } from "../config/load.js";
import { openDb } from "../db/open.js";
import { repos as makeRepos } from "../db/repos.js";
import { errorCode } from "../errors.js";
import { bootChecks } from "../boot/checks.js";
import { registerFeeWallet } from "../boot/fee-wallet.js";
import { loadMasterKey, newMasterKeyHex } from "../keys/seal.js";
import { DbOperatorKeyStore, KEY_NAMES, POC_ENVELOPE_SCALAR, generateKey, isKeyName, type KeyName } from "../keys/store.js";
import { discoverMarkets } from "../markets/discovery.js";
import { AlertService } from "../alerts/service.js";
import { createLogger } from "../observability/logger.js";
import { loadDotEnv } from "./env.js";

const out = (s: string): void => void process.stdout.write(`${s}\n`);

function usage(): never {
  out(`uso: pnpm cli <comando>

  init-master [--out data/master.key]       cria a chave mestra (32 bytes, arquivo 600)
  api-key <read|admin>                      gera uma API key; imprime a chave e o sha256 para o .env
  migrate                                   aplica as migrações do banco
  keys list                                 nomes e partes públicas
  keys generate <nome>                      ${KEY_NAMES.filter((k) => k !== "envelope").join(" | ")}
  keys import <nome> --from-file <arquivo>  importa uma chave (escalar hex ou secret S...)
  keys import envelope --poc                a chave de envelope dos POCs (MVP de teste, OP-10)
  keys export <nome> --out <arquivo> --i-understand
  keys check                                as checagens de boot (rede, chaves, fee wallet, saldo)
  bootstrap auditor-pubkey                  sk_op·H (128 hex) para o --auditor-key do deploy
  bootstrap fund <submitter|fee_wallet_stellar|admin>   friendbot (testnet/local)
  bootstrap fee-wallet                      registra a fee wallet no Confidential Token (D22)
  markets rescan                            varre a Factory agora
  markets show <market_id>                  o mercado no banco (dado público)`);
  process.exit(2);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function localKeys(): { keys: DbOperatorKeyStore; close: () => void } {
  const db = openDb(resolve(process.env["CMI_DB_PATH"] ?? "data/operator.db"));
  const file = process.env["CMI_MASTER_KEY_FILE"];
  const master = loadMasterKey(file !== undefined && file !== "" ? { file: resolve(file) } : { hex: process.env["CMI_MASTER_KEY"] ?? "" });
  return { keys: new DbOperatorKeyStore(makeRepos(db).keys, master), close: () => db.close() };
}

function keyName(s: string | undefined): KeyName {
  if (s === undefined || !isKeyName(s)) {
    out(`chave desconhecida: ${s ?? "(nenhuma)"}; use ${KEY_NAMES.join(" | ")}`);
    process.exit(2);
  }
  return s;
}

async function main(argv: string[]): Promise<void> {
  loadDotEnv();
  const [cmd, sub, ...rest] = argv;
  switch (cmd) {
    case "init-master": {
      const path = resolve(flag([sub ?? "", ...rest], "--out") ?? process.env["CMI_MASTER_KEY_FILE"] ?? "data/master.key");
      if (existsSync(path)) throw new Error(`${path} já existe; não sobrescrevo a chave mestra`);
      openDb(resolve(process.env["CMI_DB_PATH"] ?? "data/operator.db")).close();
      writeFileSync(path, `${newMasterKeyHex()}\n`, { mode: 0o600, flag: "wx" });
      out(`chave mestra criada em ${path} (permissão 600). Faça backup dela SEPARADO do banco.`);
      return;
    }
    case "api-key": {
      if (sub !== "read" && sub !== "admin") usage();
      const key = randomBytes(32).toString("base64url");
      const { createHash } = await import("node:crypto");
      out(`API key (${sub}): ${key}`);
      out(`CMI_API_KEY_${sub.toUpperCase()}_SHA256=${createHash("sha256").update(key).digest("hex")}`);
      return;
    }
    case "migrate": {
      openDb(resolve(process.env["CMI_DB_PATH"] ?? "data/operator.db")).close();
      out("migrações aplicadas");
      return;
    }
    case "keys":
      return keysCmd(sub, rest);
    case "bootstrap":
      return bootstrapCmd(sub, rest);
    case "markets":
      return marketsCmd(sub, rest);
    default:
      usage();
  }
}

async function keysCmd(sub: string | undefined, args: string[]): Promise<void> {
  if (sub === "check") return check();
  const { keys, close } = localKeys();
  try {
    if (sub === "list") {
      for (const name of KEY_NAMES) out(`${name.padEnd(20)} ${keys.has(name) ? keys.publicOf(name) : "-"}`);
      return;
    }
    const name = keyName(args[0]);
    const feeWalletAddress = keys.has("fee_wallet_stellar") ? keys.publicOf("fee_wallet_stellar") : undefined;
    const opts = feeWalletAddress === undefined ? {} : { feeWalletAddress };
    if (sub === "generate") {
      out(`${name}: ${keys.put(name, new Secret(generateKey(name)), opts)}`);
    } else if (sub === "import") {
      const text = args.includes("--poc") && name === "envelope" ? POC_ENVELOPE_SCALAR.toString(16) : readFileSync(resolve(flag(args, "--from-file") ?? usage()), "utf8");
      out(`${name}: ${keys.put(name, new Secret(text), opts)}`);
    } else if (sub === "export") {
      if (!args.includes("--i-understand")) throw new Error("keys export grava a chave PRIVADA em claro; repita com --i-understand");
      const path = resolve(flag(args, "--out") ?? usage());
      writeFileSync(path, `${keys.read(name).expose()}\n`, { mode: 0o600, flag: "wx" });
      out(`${name} exportada para ${path} (permissão 600)`);
    } else usage();
  } finally {
    close();
  }
}

async function network() {
  const config = loadConfig(process.env);
  const db = openDb(config.db.path);
  const repos = makeRepos(db);
  const keys = new DbOperatorKeyStore(repos.keys, loadMasterKey(config.masterKey));
  const logger = createLogger({ level: config.logLevel });
  return { config, db, repos, keys, logger, ports: connectChain(config) };
}

async function check(): Promise<void> {
  const n = await network();
  try {
    const r = await bootChecks({ ports: n.ports, keys: n.keys, deployment: n.config.deployment, minSubmitterStroops: n.config.tuning.submitterMinStroops });
    for (const f of r.fatal) out(`FATAL   ${f}`);
    for (const w of r.warnings) out(`${w.severity.toUpperCase().padEnd(8)}${w.message}`);
    out(`envelope key: ${r.envelopeKey ?? "-"}; fee wallet registrada: ${r.feeWalletRegistered ?? "-"}; submitter: ${r.submitter?.address ?? "-"} (${r.submitter?.xlmStroops ?? "-"} stroops)`);
    if (r.fatal.length > 0) process.exitCode = 1;
  } finally {
    n.db.close();
  }
}

async function bootstrapCmd(sub: string | undefined, args: string[]): Promise<void> {
  if (sub === "auditor-pubkey") {
    const { keys, close } = localKeys();
    try {
      out(keys.publicOf("spender"));
    } finally {
      close();
    }
    return;
  }
  const n = await network();
  try {
    if (sub === "fund") {
      const name = keyName(args[0]);
      const address = n.keys.publicOf(name);
      const url =
        process.env["CMI_FRIENDBOT_URL"] ?? (n.config.network === "testnet" ? "https://friendbot.stellar.org" : new URL("/friendbot", n.config.deployment.rpcUrl).toString());
      const res = await fetch(`${url}?addr=${encodeURIComponent(address)}`);
      if (!res.ok && res.status !== 400) throw new Error(`friendbot respondeu ${res.status}`);
      out(`${name} (${address}): ${res.ok ? "financiada" : "já existia"}`);
      return;
    }
    if (sub === "fee-wallet") {
      const address = n.keys.publicOf("fee_wallet_stellar");
      if (address !== n.config.deployment.feeWallet) throw new Error(`a fee_wallet_stellar (${address}) não é a fee wallet do deployment (${n.config.deployment.feeWallet})`);
      if ((await n.ports.token.account(address)) !== null) {
        out(`fee wallet ${address} já tem conta no token`);
        return;
      }
      const prover = connectProver(n.config);
      try {
        const r = await registerFeeWallet({
          token: n.ports.token,
          tokenAddress: n.config.deployment.contracts.token,
          auditorId: n.config.deployment.auditor.id,
          prover,
          signer: n.keys.signer("fee_wallet_stellar"),
          tokenSk: n.keys.scalar("fee_wallet_token"),
        });
        out(`fee wallet ${address} registrada no token (tx ${r.tx ?? "-"})`);
      } finally {
        await prover.destroy();
      }
      return;
    }
    usage();
  } finally {
    n.db.close();
  }
}

async function marketsCmd(sub: string | undefined, args: string[]): Promise<void> {
  const n = await network();
  try {
    if (sub === "rescan") {
      const alerts = new AlertService({ repo: n.repos.alerts, logger: n.logger });
      const added = await discoverMarkets({ ports: n.ports, repos: n.repos, alerts, logger: n.logger, ledger: await n.ports.latestLedger() });
      out(`mercados novos: ${added.join(", ") || "-"}`);
    } else if (sub === "show") {
      const id = args[0];
      if (id === undefined || !/^\d+$/.test(id)) usage();
      const m = n.repos.markets.get(BigInt(id));
      if (m === null) throw new Error(`mercado ${id} não está no banco`);
      out(JSON.stringify({ ...m, bids: n.repos.bids.forMarket(m.marketId) }, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v), 2));
    } else usage();
  } finally {
    n.db.close();
  }
}

main(process.argv.slice(2)).catch((e: unknown) => {
  process.stderr.write(`erro (${errorCode(e)}): ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
