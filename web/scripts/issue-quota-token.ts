#!/usr/bin/env tsx
/**
 * Passo 1.3 (F-13): ativo clássico de cotas de teste na testnet, sem clawback, com o SAC
 * implantado. 1 cota = 1 unidade clássica (7 casas) = QUOTA_UNIT unidades base.
 *
 * A trustline da empresa exige a assinatura da empresa. Com `--holder-secret` (carteira dev)
 * o script assina; com a Freighter ele para e imprime a instrução, e `--resume` continua
 * depois que a trustline existir. O estado fica em .local/tokens.json (ignorado pelo git).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { Asset, Contract, Keypair } from "@stellar/stellar-sdk";
import { QUOTA_UNIT } from "@zolvency-cmi/core";

import { UsageError, done, fail, parseArgs, step, warn } from "./lib/cli.js";
import {
  addTrustline,
  deploySac,
  fund,
  horizonAccount,
  pay,
  rpcServer,
  trustlineBalance,
  type ClassicNetwork,
} from "./lib/classic.js";
import { readConfig } from "./lib/config.js";
import { ensureLocalDir, tokensPath } from "./lib/paths.js";

const USAGE = `uso: pnpm token:issue --to <G… da empresa> [--amount 1000] [--code QUOTA]
                        [--holder-secret <S…>] [--resume] [--new]

  --to <G…>             conta que recebe as cotas (precisa existir; use pnpm fund)
  --amount <n>          cotas a emitir (padrão 1000, inteiro)
  --code <código>       código do ativo (padrão QUOTA)
  --holder-secret <S…>  assina a trustline com esta chave (carteira de desenvolvimento)
  --resume              continua uma emissão pausada esperando a trustline
  --new                 cria um emissor novo mesmo se já houver uma emissão para esta conta

Prefira CMI_HOLDER_SECRET=S… no ambiente: o pnpm imprime os argumentos do script, e um
--holder-secret no terminal fica no histórico. A chave do emissor fica em .local/tokens.json
(0600), só para continuar a emissão.`;

const ACCOUNT = /^G[A-Z2-7]{55}$/;
const SECRET = /^S[A-Z2-7]{55}$/;

interface TokenRecord {
  code: string;
  issuer: string;
  /** Só existe para terminar a emissão na testnet; nunca vai para o app. */
  issuerSecret: string;
  sac: string;
  holder: string;
  amount: number;
  paid: boolean;
  createdLedger: number | null;
}

interface TokensFile {
  tokens: TokenRecord[];
}

function loadTokens(): TokensFile {
  if (!existsSync(tokensPath)) return { tokens: [] };
  try {
    const parsed = JSON.parse(readFileSync(tokensPath, "utf8")) as TokensFile;
    return Array.isArray(parsed.tokens) ? parsed : { tokens: [] };
  } catch {
    return fail(`${tokensPath} não é um JSON válido; apague-o se não houver emissão em andamento`);
  }
}

function saveTokens(file: TokensFile): void {
  ensureLocalDir();
  writeFileSync(tokensPath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
}

function lastFor(file: TokensFile, holder: string, code: string): TokenRecord | undefined {
  for (let i = file.tokens.length - 1; i >= 0; i--) {
    const record = file.tokens[i]!;
    if (record.holder === holder && record.code === code) return record;
  }
  return undefined;
}

function parseAmount(raw: string): number {
  if (!/^[1-9][0-9]*$/.test(raw)) fail("--amount deve ser um inteiro positivo (cotas)");
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) fail("--amount grande demais");
  return value;
}

function parseCode(raw: string): string {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,12}$/.test(code)) fail("--code deve ter de 1 a 12 caracteres A-Z/0-9");
  return code;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), ["to", "amount", "code", "holder-secret"]);
  if (args.flags.has("help")) {
    console.log(USAGE);
    return;
  }
  if (args.positional.length > 0) throw new UsageError(`argumento inesperado: ${args.positional[0]}`);
  for (const flag of args.flags) {
    if (flag !== "resume" && flag !== "new") throw new UsageError(`opção desconhecida: --${flag}`);
  }

  const holder = args.values.get("to")?.trim();
  if (holder === undefined) throw new UsageError("falta --to <G… da empresa>");
  if (!ACCOUNT.test(holder)) fail("--to deve ser uma conta Stellar que começa com G");

  const holderSecretRaw = (args.values.get("holder-secret") ?? process.env.CMI_HOLDER_SECRET ?? "").trim();
  const holderSecret = holderSecretRaw.length === 0 ? undefined : holderSecretRaw;
  if (holderSecret !== undefined && !SECRET.test(holderSecret)) fail("a chave do holder não é uma chave secreta Stellar (S…)");
  const holderKp = holderSecret === undefined ? null : Keypair.fromSecret(holderSecret);
  if (holderKp !== null && holderKp.publicKey() !== holder) fail("--holder-secret não corresponde a --to");

  const code = parseCode(args.values.get("code") ?? "QUOTA");
  const amount = parseAmount(args.values.get("amount") ?? "1000");

  const config = readConfig();
  if (config === null) fail("config ausente ou inválida: rode `pnpm sync:deployment` primeiro");
  const network: ClassicNetwork = {
    horizonUrl: config.horizonUrl,
    friendbotUrl: config.friendbotUrl,
    rpcUrl: config.rpcUrl,
    passphrase: config.passphrase,
  };

  const file = loadTokens();
  let record = args.flags.has("new") ? undefined : lastFor(file, holder, code);
  if (record === undefined) {
    if (args.flags.has("resume")) fail("não há emissão pausada para esta conta/código; rode sem --resume");
    step("criando um emissor novo para o ativo de cotas");
    const issuer = Keypair.random();
    await fund(network, issuer.publicKey());
    const asset = new Asset(code, issuer.publicKey());
    record = {
      code,
      issuer: issuer.publicKey(),
      issuerSecret: issuer.secret(),
      sac: asset.contractId(network.passphrase),
      holder,
      amount,
      paid: false,
      createdLedger: null,
    };
    file.tokens.push(record);
    saveTokens(file);
    step(`emissor ${record.issuer} financiado (a chave ficou em ${tokensPath})`);
  } else {
    step(`retomando a emissão existente do emissor ${record.issuer}`);
    if (record.amount !== amount) warn(`--amount ${amount} ignorado; esta emissão paga ${record.amount} cotas (use --new para outra)`);
  }

  const issuer = Keypair.fromSecret(record.issuerSecret);
  if (issuer.publicKey() !== record.issuer) fail("estado local corrompido: a chave não corresponde ao emissor");
  const asset = new Asset(record.code, record.issuer);

  const issuerAccount = await horizonAccount(network, record.issuer);
  if (issuerAccount === null) fail(`o emissor ${record.issuer} não existe mais na testnet`);
  if (
    issuerAccount.flags.auth_required === true ||
    issuerAccount.flags.auth_revocable === true ||
    issuerAccount.flags.clawback_enabled === true
  ) {
    fail("o emissor tem auth revogável/exigida ou clawback; o ativo não serve para cotas (D18)");
  }

  const holderAccount = await horizonAccount(network, holder);
  if (holderAccount === null) {
    fail(`a conta ${holder} não existe na testnet. Rode \`pnpm fund --to ${holder}\` e tente de novo.`);
  }

  let balance = trustlineBalance(holderAccount, asset);
  if (balance === null) {
    if (holderKp !== null) {
      await addTrustline(network, holderKp, asset);
      balance = "0";
    } else {
      saveTokens(file);
      console.log("");
      console.log(`A conta ${holder} ainda não tem trustline para ${code}:${record.issuer}.`);
      console.log("Peça a assinatura da empresa no app (Carteira → Habilitar ativo) e rode de novo:");
      console.log(`  pnpm token:issue --to ${holder} --code ${code} --amount ${record.amount} --resume`);
      console.log("");
      warn("emissão pausada; use --holder-secret (ou CMI_HOLDER_SECRET) para assinar a trustline aqui");
      process.exitCode = 2;
      return;
    }
  }

  if (!record.paid) {
    await pay(network, issuer, holder, asset, String(record.amount));
    record.paid = true;
    saveTokens(file);
    step(`${record.amount} cotas = ${BigInt(record.amount) * QUOTA_UNIT} unidades base (1 cota = QUOTA_UNIT)`);
  } else {
    step(`esta emissão já pagou ${record.amount} cotas a ${holder}`);
  }

  // A SAC é um contrato embutido (sem wasm próprio), então a existência é lida pela entrada
  // da instância, não pelo `contractWasmHash`.
  const server = rpcServer(network);
  const { entries } = await server.getLedgerEntries(new Contract(record.sac).getFootprint());
  if (entries.length === 0) await deploySac(network, issuer, asset);

  record.sac = asset.contractId(network.passphrase);
  record.createdLedger = (await server.getLatestLedger()).sequence;
  saveTokens(file);

  const after = await horizonAccount(network, holder);
  const finalBalance = trustlineBalance(after, asset) ?? "0";
  console.log("");
  console.log("  ativo de cotas pronto");
  console.log(`  código          ${record.code}`);
  console.log(`  emissor         ${record.issuer}`);
  console.log(`  SAC             ${record.sac}   ← quota_asset`);
  console.log(`  carteira        ${holder} (${finalBalance} ${record.code})`);
  console.log(`  sem clawback    auth_required=false auth_revocable=false clawback=false`);
  console.log("");
  console.log("  no wizard de leilão, informe o SAC acima como o ativo das cotas.");
  done(`estado em ${tokensPath}`);
}

main().catch((error: unknown) => {
  console.error(`erro: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
