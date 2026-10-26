import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Keypair } from "@stellar/stellar-sdk";
import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { InMemoryKeyProvider, connectClient } from "@zolvency-cmi/client";
import { Secret, chainAuctionPort, chainTokenPort, createProver, keypairSigner } from "@zolvency-cmi/core";
import { CmiOperator, InMemoryOperatorKeyStore } from "@zolvency-cmi/operator";
import { addTrustline, fundAccount, issueQuotaAsset, loadLocalDeployment, localChain } from "@zolvency-cmi/testing";
import { chromium } from "playwright";
import { build, preview } from "vite";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Passo 6.2: o `bidder-web` no Chromium faz o fluxo inteiro do bidder contra a rede local —
 * register, deposit, merge, as duas provas no navegador, set_spender e submit_bid. O Node só
 * prepara o mercado (seller e operador) e financia a conta. Exige a rede local (S-13).
 */
describe("bidder-web no Chromium", () => {
  const prover = createProver({ artifacts: loadDevArtifacts() });
  afterAll(() => prover.destroy());

  it("bidder-web places a bid in Chromium against localnet", { timeout: 900_000 }, async () => {
    const dep = loadLocalDeployment();
    const chain = localChain(dep);
    const contracts = { factory: dep.contracts.factory, token: dep.contracts.token, auditor: dep.contracts.auditor };
    const [sellerKp, submitterKp, bidderKp] = [Keypair.random(), Keypair.random(), Keypair.random()];
    await Promise.all([sellerKp, submitterKp, bidderKp].map((k) => fundAccount(k.publicKey())));
    const seller = connectClient({ chain, contracts, signer: keypairSigner(sellerKp.secret()), keys: new InMemoryKeyProvider(), prover });
    await seller.account.ensureRegistered();
    const quota = await issueQuotaAsset({ holders: [{ kp: sellerKp, quotas: 1_000 }] });
    await addTrustline(bidderKp, quota.asset);
    const operator = new CmiOperator({
      keys: new InMemoryOperatorKeyStore({ spenderKey: new Secret(0x0a0c_7105_0006_0002n), envelopeKey: new Secret(987_654_321_098n), submitter: keypairSigner(submitterKp.secret()) }),
      factory: seller.factory, tokenAddress: dep.contracts.token, prover,
      auction: (address) => chainAuctionPort({ chain, address }), token: chainTokenPort({ chain, token: dep.contracts.token, auditor: dep.contracts.auditor }),
    });
    const { marketId, address } = await seller.seller.createMarket(
      { quotaAsset: quota.sac, totalQuotas: 1_000, minPricePerQuota: 500n, closeLedger: (await chain.latestLedger()) + 2_000, eligibilityPolicy: null, feeReserve: 50_000_000n },
      { forNextMarket: () => operator.registerDataForNextMarket() },
    );
    await seller.seller.openMarket(marketId);

    await build({ root: ROOT, configFile: join(ROOT, "vite.config.ts"), logLevel: "silent" });
    const server = await preview({ root: ROOT, configFile: join(ROOT, "vite.config.ts"), preview: { port: 4177, strictPort: true }, logLevel: "silent" });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const q = new URLSearchParams({
        rpc: dep.rpcUrl, passphrase: dep.networkPassphrase, factory: contracts.factory, token: contracts.token, auditor: contracts.auditor,
        market: marketId.toString(), price: "650", quantity: "100", secret: bidderKp.secret(), autorun: "1",
      });
      await page.goto(`http://localhost:4177/?${q}`);
      await page.waitForFunction(() => /^(placed|error)/.test(document.querySelector("#status")?.textContent ?? ""), undefined, { timeout: 600_000 });
      expect(await page.textContent("#status")).toBe("placed: bid 0");
    } finally {
      await browser.close();
      await new Promise<void>((r) => server.httpServer.close(() => r()));
    }

    const auction = chainAuctionPort({ chain, address });
    expect(await auction.getBidCount()).toBe(1);
    expect((await auction.getBidRecord(0)).bidder).toBe(bidderKp.publicKey());
    expect(await chainTokenPort({ chain, token: dep.contracts.token, auditor: dep.contracts.auditor }).isSpender(bidderKp.publicKey(), address)).toBe(true);
  });
});
