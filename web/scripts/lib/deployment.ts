import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { contractsRoot } from "./paths.js";
import { fail } from "./cli.js";

const CONTRACT = /^C[A-Z2-7]{55}$/;
const ACCOUNT = /^G[A-Z2-7]{55}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

export interface DeploymentContracts {
  underlying: string;
  verifier: string;
  auditor: string;
  token: string;
  bid_verifier: string;
  allocation_verifier: string;
  settlement_verifier: string;
  factory: string;
}

/** O `deployments/testnet.json` do repositório de contratos (snake_case, como o deploy grava). */
export interface Deployment {
  network: string;
  rpc_url: string;
  passphrase: string;
  deployed_at_ledger: number;
  contracts: DeploymentContracts;
  auction_wasm_hash: string;
  auditor: { id: number; key: string };
  fee_wallet: string;
  finalization_grace_ledgers: number;
  wasm_sha256: Record<string, string>;
  token_vks: Record<string, string>;
  pending: unknown[];
}

const CONTRACT_FIELDS = [
  "underlying",
  "verifier",
  "auditor",
  "token",
  "bid_verifier",
  "allocation_verifier",
  "settlement_verifier",
  "factory",
] as const satisfies readonly (keyof DeploymentContracts)[];

function obj(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(`${what} ausente ou inválido no deployment`);
  return v as Record<string, unknown>;
}

function str(v: unknown, what: string): string {
  if (typeof v !== "string" || v.length === 0) fail(`${what} ausente ou inválido no deployment`);
  return v;
}

function contract(v: unknown, what: string): string {
  const s = str(v, what);
  if (!CONTRACT.test(s)) fail(`${what} não é um endereço de contrato Stellar: ${s}`);
  return s;
}

function hex(v: unknown, what: string, length: 64 | 128): string {
  const s = str(v, what).toLowerCase();
  if (!(length === 64 ? HEX64 : HEX128).test(s)) fail(`${what} não é um sha256 (${length} dígitos hex) em minúsculas`);
  return s;
}

function record(v: unknown, what: string): Record<string, string> {
  const r = obj(v, what);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(r)) out[key] = hex(value, `${what}.${key}`, 64);
  return out;
}

/** Valida o JSON do deploy antes de qualquer leitura de rede. Nada aqui toca segredo. */
export function parseDeployment(input: unknown): Deployment {
  const d = obj(input, "deployment");
  const contracts = obj(d.contracts, "contracts");
  const auditor = obj(d.auditor, "auditor");
  const ids = CONTRACT_FIELDS.map((name) => [name, contract(contracts[name], `contracts.${name}`)] as const);
  const contractsOut = Object.fromEntries(ids) as unknown as DeploymentContracts;

  const network = str(d.network, "network");
  if (network !== "testnet") fail(`o deployment é de "${network}", mas este projeto configura a testnet`);

  const passphrase = str(d.passphrase, "passphrase");
  const feeWallet = str(d.fee_wallet, "fee_wallet");
  if (!ACCOUNT.test(feeWallet)) fail(`fee_wallet não é uma conta Stellar: ${feeWallet}`);

  const auditorId = auditor.id;
  if (typeof auditorId !== "number" || !Number.isInteger(auditorId) || auditorId < 0) fail("auditor.id inválido");

  const deployedAt = d.deployed_at_ledger;
  if (typeof deployedAt !== "number" || !Number.isInteger(deployedAt) || deployedAt <= 0) fail("deployed_at_ledger inválido");

  const grace = d.finalization_grace_ledgers;
  if (typeof grace !== "number" || !Number.isInteger(grace) || grace <= 0) fail("finalization_grace_ledgers inválido");

  if (!Array.isArray(d.pending)) fail("pending ausente ou inválido no deployment");

  return {
    network,
    rpc_url: str(d.rpc_url, "rpc_url"),
    passphrase,
    deployed_at_ledger: deployedAt,
    contracts: contractsOut,
    auction_wasm_hash: hex(d.auction_wasm_hash, "auction_wasm_hash", 64),
    auditor: { id: auditorId, key: hex(auditor.key, "auditor.key", 128) },
    fee_wallet: feeWallet,
    finalization_grace_ledgers: grace,
    wasm_sha256: record(d.wasm_sha256, "wasm_sha256"),
    token_vks: record(d.token_vks, "token_vks"),
    pending: d.pending,
  };
}

export interface LoadedDeployment {
  deployment: Deployment;
  source: string;
}

function parseJson(text: string, where: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    fail(`${where} não é um JSON válido`);
  }
}

/**
 * Lê o deployment da `main` dos contratos sem mexer no checkout (`git show`), como na F-06.
 * Um caminho explícito (`--file`) vence; sem ele, tenta a `main` e depois o arquivo local.
 */
export function loadDeployment(file?: string): LoadedDeployment {
  if (file !== undefined) {
    if (!existsSync(file)) fail(`arquivo não encontrado: ${file}`);
    return { deployment: parseDeployment(parseJson(readFileSync(file, "utf8"), file)), source: file };
  }

  const gitPath = "deployments/testnet.json";
  try {
    const text = execFileSync("git", ["-C", contractsRoot, "show", `origin/main:${gitPath}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return { deployment: parseDeployment(parseJson(text, `origin/main:${gitPath}`)), source: `git ${contractsRoot} origin/main:${gitPath}` };
  } catch {
    // Sem remoto ou sem a branch: o checkout local ainda pode ter o arquivo.
  }

  const local = join(contractsRoot, gitPath);
  if (existsSync(local)) {
    return { deployment: parseDeployment(parseJson(readFileSync(local, "utf8"), local)), source: local };
  }

  return fail(
    `não achei deployments/testnet.json em origin/main nem em ${local}. ` +
      "Rode `git -C sdk/contracts fetch origin` ou passe --file <caminho>.",
  );
}
