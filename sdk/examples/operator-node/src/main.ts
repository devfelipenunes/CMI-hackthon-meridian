/**
 * Exemplo `operator-node`: o keeper do operador sobre os mercados de uma rede.
 *
 *   pnpm --filter @zolvency-cmi/example-operator-node start -- <endereço da Auction> [...]
 *
 * Lê a rede e os contratos de `DEPLOYMENT` (padrão: `deployments/local.json`, o que o
 * `scripts/deploy-local.sh` grava) e as chaves do operador do ambiente. Só para demonstração:
 * no back-end real, as chaves vêm de um `OperatorKeyStore` sobre o banco ou um HSM (S-11), nunca
 * de variáveis de ambiente.
 *
 *   CMI_OPERATOR_SPENDER_KEY   sk_op (hex)
 *   CMI_OPERATOR_ENVELOPE_KEY  sk do PK_operator (hex)
 *   CMI_OPERATOR_SUBMITTER     chave secreta Stellar (S...) da conta que envia as transações
 */
import { readFileSync } from "node:fs";

import { loadArtifacts, loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { ChainClient, Secret, createProver, keypairSigner } from "@zolvency-cmi/core";
import { InMemoryOperatorKeyStore } from "@zolvency-cmi/operator";

import { runOperatorKeeper } from "./operator.js";

function env(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") throw new Error(`falta ${name}`);
  return v;
}

const dep = JSON.parse(readFileSync(process.env["DEPLOYMENT"] ?? new URL("../../../deployments/local.json", import.meta.url), "utf8")) as {
  rpc_url: string;
  passphrase: string;
  contracts: { factory: string; token: string; auditor: string };
};
const markets = process.argv.slice(2).filter((a) => a !== "--");
if (markets.length === 0) throw new Error("uso: start -- <endereço da Auction> [...]");

const release = process.env["CMI_CONTRACTS_RELEASE"];
const prover = createProver({ artifacts: release === undefined ? loadDevArtifacts() : loadArtifacts({ release }) });
const ac = new AbortController();
process.on("SIGINT", () => ac.abort());

try {
  const r = await runOperatorKeeper({
    chain: new ChainClient({ rpcUrl: dep.rpc_url, networkPassphrase: dep.passphrase, allowHttp: dep.rpc_url.startsWith("http://") }),
    contracts: dep.contracts,
    keys: new InMemoryOperatorKeyStore({
      spenderKey: new Secret(BigInt(`0x${env("CMI_OPERATOR_SPENDER_KEY")}`)),
      envelopeKey: new Secret(BigInt(`0x${env("CMI_OPERATOR_ENVELOPE_KEY")}`)),
      submitter: keypairSigner(env("CMI_OPERATOR_SUBMITTER")),
    }),
    prover,
    markets,
    signal: ac.signal,
    onEvent: (e) => process.stdout.write(`${e.kind} ${"bidIndex" in e && e.bidIndex !== undefined ? `bid ${e.bidIndex} ` : ""}${"action" in e ? JSON.stringify(e.action) : ""}\n`),
  });
  process.stdout.write(`terminados: ${r.done.join(", ") || "-"}; pulados: ${r.skipped.map((s) => `${s.market} (${s.code})`).join(", ") || "-"}\n`);
} finally {
  await prover.destroy();
}
process.exit(0);
