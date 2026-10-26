import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Keypair, rpc } from "@stellar/stellar-sdk";

import { ChainClient } from "../../src/index.js";

const LOCAL_JSON = fileURLToPath(new URL("../../../../deployments/local.json", import.meta.url));
const FRIENDBOT = "http://localhost:8000/friendbot";

export interface Local {
  chain: ChainClient;
  token: string;
  auditor: string;
  factory: string;

  xlm: string;
}

export function local(): Local {
  let j: { rpc_url: string; passphrase: string; contracts: { token: string; auditor: string; factory: string; underlying: string } };
  try {
    j = JSON.parse(readFileSync(LOCAL_JSON, "utf8")) as typeof j;
  } catch {
    throw new Error("não há deployments/local.json: rode ./scripts/localnet.sh up && ./scripts/deploy-local.sh");
  }
  return {
    chain: new ChainClient({ rpcUrl: j.rpc_url, networkPassphrase: j.passphrase, allowHttp: true, pollIntervalMs: 500 }),
    token: j.contracts.token,
    auditor: j.contracts.auditor,
    factory: j.contracts.factory,
    xlm: j.contracts.underlying,
  };
}

export async function fundedKeypair(): Promise<Keypair> {
  const kp = Keypair.random();
  const res = await fetch(`${FRIENDBOT}?addr=${encodeURIComponent(kp.publicKey())}`);
  if (!res.ok) throw new Error(`friendbot respondeu ${res.status}`);

  const server = new rpc.Server("http://localhost:8000/soroban/rpc", { allowHttp: true });
  for (let i = 0; i < 60 && !(await server.getAccount(kp.publicKey()).then(() => true, () => false)); i++) await new Promise((r) => setTimeout(r, 500));
  return kp;
}
