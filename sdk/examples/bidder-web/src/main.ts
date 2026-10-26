import "./polyfills.js";

import { BrowserKeyProvider, MemoryOpeningStore, connectClient } from "@zolvency-cmi/client";
import { ChainClient, CmiError, browserBackendLoader, createProver, keypairSigner } from "@zolvency-cmi/core";

import { loadBrowserArtifacts } from "./artifacts.js";

/**
 * Exemplo `bidder-web`: o fluxo do bidder no navegador (fluxo 5.2 da ARCHITECTURE) — conta
 * confidencial, depósito, as duas provas (`bid_validity` e `set_spender`) no Chromium, o lock e o
 * `submit_bid`. A rede e os contratos vêm da URL (`?rpc=…&passphrase=…&factory=…&token=…&auditor=…`).
 *
 * Só para o exemplo e o teste, a conta assina com uma chave secreta da URL (`secret`). Num app
 * real, quem assina é a carteira do usuário (um `Signer` sobre a Freighter, por exemplo): a chave
 * Stellar nunca passa pelo app.
 */
const q = new URLSearchParams(location.search);
const statusEl = document.querySelector<HTMLDivElement>("#status")!;
const say = (s: string): void => void (statusEl.textContent = s);
const field = (name: string): HTMLInputElement => document.querySelector<HTMLInputElement>(`#${name}`)!;
for (const name of ["market", "price", "quantity"]) field(name).value = q.get(name) ?? "";

function config(name: string): string {
  const v = q.get(name);
  if (v === null || v === "") throw new Error(`falta o parâmetro ${name} na URL`);
  return v;
}

async function placeBid(): Promise<void> {
  const rpcUrl = config("rpc");
  const passphrase = config("passphrase");
  const chain = new ChainClient({ rpcUrl, networkPassphrase: passphrase, allowHttp: rpcUrl.startsWith("http://") });
  say("carregando os circuitos…");
  const prover = createProver({ artifacts: await loadBrowserArtifacts(), backendLoader: browserBackendLoader(), threads: navigator.hardwareConcurrency });
  try {
    const client = connectClient({
      chain,
      contracts: { factory: config("factory"), token: config("token"), auditor: config("auditor") },
      signer: keypairSigner(config("secret")),
      keys: new BrowserKeyProvider({ network: passphrase }),
      prover,
      openings: new MemoryOpeningStore(),
    });
    const marketId = BigInt(field("market").value);
    const price = BigInt(field("price").value);
    const quantity = Number(field("quantity").value);

    say("conta confidencial…");
    const { backupRequired } = await client.account.ensureRegistered();
    if (backupRequired) console.info("chave confidencial nova: num app real, peça o backup agora (exportBackup)");
    say("depósito…");
    await client.account.deposit(price * BigInt(quantity)); // público (S-17): um app real deposita um valor que não revele o preço
    await client.account.merge();
    say("gerando as provas no navegador…");
    const prepared = await client.bidder.prepareBid(marketId, price, quantity);
    say("travando o colateral e enviando o lance…");
    const { bidIndex } = await client.bidder.placeBid(prepared);
    say(`placed: bid ${bidIndex}`);
  } finally {
    await prover.destroy();
  }
}

function run(): void {
  placeBid().catch((e: unknown) => {
    // Só o código do erro: a mensagem do SDK nunca carrega segredo (S-16), mas o código basta para a UI.
    say(`error: ${e instanceof CmiError ? `${e.code}${e.recovery === undefined ? "" : ` (recovery: ${e.recovery})`}` : e instanceof Error ? e.message : String(e)}`);
  });
}

document.querySelector("#bid")!.addEventListener("submit", (ev) => {
  ev.preventDefault();
  run();
});
if (q.get("autorun") === "1") run();
