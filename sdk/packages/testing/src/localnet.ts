import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Networks, StrKey, rpc } from "@stellar/stellar-sdk";
import {
  ChainClient,
  TOKEN_H,
  addressToField,
  buildRegisterWitness,
  chainTokenPort,
  encodeRegisterData,
  generateTokenKeys,
  pointToBytes,
  scalarMul,
  type Prover,
  type Signer,
} from "@zolvency-cmi/core";

export interface TestNetwork {
  rpcUrl: string;
  networkPassphrase: string;
  friendbotUrl: string;

  secondsPerLedger: number;

  secondsPerBid: number;
}

export const LOCALNET: TestNetwork = Object.freeze({
  rpcUrl: "http://localhost:8000/soroban/rpc",
  networkPassphrase: Networks.STANDALONE,
  friendbotUrl: "http://localhost:8000/friendbot",
  secondsPerLedger: 1,
  secondsPerBid: 30,
});

export const TESTNET: TestNetwork = Object.freeze({
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: Networks.TESTNET,
  friendbotUrl: "https://friendbot.stellar.org",
  secondsPerLedger: 5,
  secondsPerBid: 90,
});

let active: TestNetwork = LOCALNET;

export function setTestNetwork(n: TestNetwork): void {
  active = n;
}

export function testNetwork(): TestNetwork {
  return active;
}

export function bidWindow(n: number): number {
  return ledgersFor(2 * n * active.secondsPerBid);
}

export function ledgersFor(seconds: number): number {
  return Math.ceil(seconds / active.secondsPerLedger);
}

export const PINNED_WASM_SHA256 = {
  confidential_token: "74b6978c0519e6a1807f54a9677c47555a7f696a3d336603a79b63773f4fb6d8",
  confidential_verifier: "0ececaae8cbd3c78f19d9057d80a73799b35468074081dc2d92bebe91b2e3552",
  confidential_auditor: "43303f4421d2bab6020f8a82312f09533c3612509677a646792b9c82cb31d05f",
  ultrahonk_verifier: "7ec8c9e50a1a2862652074bcd6df6b46e17180253c95da981db72e28e93b8e70",
} as const;

export const TOKEN_VK_CIRCUITS = ["register", "withdraw", "transfer", "spender_transfer", "set_spender", "revoke_spender"] as const;

export interface LocalDeployment {
  networkPassphrase: string;
  rpcUrl: string;
  admin: string;
  contracts: {
    underlying: string;
    verifier: string;
    auditor: string;
    token: string;
    bidVerifier: string;
    allocationVerifier: string;
    settlementVerifier: string;
    factory: string;
  };
  auctionWasmHash: string;

  auditor: { id: number; key: string };
  feeWallet: string;
}

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const LOCAL_DEPLOYMENT_PATH = `${REPO_ROOT}deployments/local.json`;

function field(obj: Record<string, unknown>, path: string, key: string): unknown {
  if (!(key in obj)) throw new Error(`deployment: falta ${path}${key}`);
  return obj[key];
}

function str(obj: Record<string, unknown>, path: string, key: string): string {
  const v = field(obj, path, key);
  if (typeof v !== "string") throw new Error(`deployment: ${path}${key} não é texto`);
  return v;
}

function contractId(obj: Record<string, unknown>, key: string): string {
  const v = str(obj, "contracts.", key);
  if (!StrKey.isValidContract(v)) throw new Error(`deployment: contracts.${key} não é um contract id`);
  return v;
}

export function parseDeployment(json: unknown): LocalDeployment {
  if (typeof json !== "object" || json === null) throw new Error("deployment: não é um objeto");
  const j = json as Record<string, unknown>;
  const c = field(j, "", "contracts") as Record<string, unknown>;
  const a = field(j, "", "auditor") as Record<string, unknown>;
  const key = str(a, "auditor.", "key");
  if (!/^[0-9a-f]{128}$/i.test(key)) throw new Error("deployment: auditor.key não tem 128 hex");
  return {
    networkPassphrase: str(j, "", "passphrase"),
    rpcUrl: str(j, "", "rpc_url"),
    admin: str(j, "", "admin"),
    contracts: {
      underlying: contractId(c, "underlying"),
      verifier: contractId(c, "verifier"),
      auditor: contractId(c, "auditor"),
      token: contractId(c, "token"),
      bidVerifier: contractId(c, "bid_verifier"),
      allocationVerifier: contractId(c, "allocation_verifier"),
      settlementVerifier: contractId(c, "settlement_verifier"),
      factory: contractId(c, "factory"),
    },
    auctionWasmHash: str(j, "", "auction_wasm_hash"),
    auditor: { id: Number(field(a, "auditor.", "id")), key: key.toLowerCase() },
    feeWallet: str(j, "", "fee_wallet"),
  };
}

export function loadLocalDeployment(path = LOCAL_DEPLOYMENT_PATH): LocalDeployment {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`não há ${path}: rode ./scripts/localnet.sh up && ./scripts/deploy-local.sh`);
  }
  return parseDeployment(JSON.parse(text));
}

export function localChain(dep?: LocalDeployment): ChainClient {
  return new ChainClient({
    rpcUrl: dep?.rpcUrl ?? active.rpcUrl,
    networkPassphrase: dep?.networkPassphrase ?? active.networkPassphrase,
    allowHttp: (dep?.rpcUrl ?? active.rpcUrl).startsWith("http://"),
    pollIntervalMs: 500,
  });
}

export function auditorKeyHex(a: bigint): string {
  return Buffer.from(pointToBytes(scalarMul(a, TOKEN_H))).toString("hex");
}

export async function fundAccount(address: string, friendbotUrl: string = active.friendbotUrl, rpcUrl: string = active.rpcUrl): Promise<void> {
  const res = await fetch(`${friendbotUrl}?addr=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`friendbot respondeu ${res.status}`);
  const server = new rpc.Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });
  for (let i = 0; i < 60; i++) {
    if (await server.getAccount(address).then(() => true, () => false)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`a conta ${address} não apareceu no ledger depois do friendbot`);
}

export async function registerLocalAccount(cfg: { chain: ChainClient; dep: LocalDeployment; signer: Signer; prover: Prover }): Promise<boolean> {
  const { chain, dep, signer, prover } = cfg;
  const token = chainTokenPort({ chain, token: dep.contracts.token, auditor: dep.contracts.auditor });
  if ((await token.account(signer.address)) !== null) return false;
  const w = buildRegisterWitness(generateTokenKeys(addressToField(dep.contracts.token)));
  const { proof } = await prover.prove("register", w.inputs);
  await token.register(signer, dep.auditor.id, encodeRegisterData(w, proof));
  return true;
}
