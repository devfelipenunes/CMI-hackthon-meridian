import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Keypair } from "@stellar/stellar-sdk";
import { InMemoryKeyProvider, MemoryOpeningStore, connectClient, type CmiClient } from "@zolvency-cmi/client";
import { ChainClient, Secret, keypairSigner } from "@zolvency-cmi/core";
import { LOCALNET, TESTNET, addTrustline, assertNoSecretLeak, bidWindow, fundAccount, issueQuotaAsset, setTestNetwork } from "@zolvency-cmi/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectChain, connectProver } from "../../src/chain/connect.js";
import { parseDeployment, type ServiceConfig } from "../../src/config/load.js";
import { openDb } from "../../src/db/open.js";
import { repos } from "../../src/db/repos.js";
import { loadMasterKey } from "../../src/keys/seal.js";
import { DbOperatorKeyStore, POC_ENVELOPE_SCALAR, generateKey } from "../../src/keys/store.js";
import { buildService, type Service } from "../../src/service.js";
import { ADMIN_KEY, READ_KEY, memoryLogger, testConfig } from "../helpers/service.js";

const NETWORK = process.env["CMI_E2E_NETWORK"] === "testnet" ? "testnet" : "local";
const NET = NETWORK === "testnet" ? TESTNET : LOCALNET;
const DEPLOYMENT = process.env["CMI_E2E_DEPLOYMENT"] === undefined
  ? new URL(`../../deployments/${NETWORK}.json`, import.meta.url)
  : resolve(process.cwd(), process.env["CMI_E2E_DEPLOYMENT"]);
const enabled = existsSync(DEPLOYMENT);

const MAX_GRACE_FOR_TIMEOUT = 720;

const PRICES = [
  { price: 650_137n, quantity: 200 },
  { price: 600_248n, quantity: 500 },
  { price: 580_391n, quantity: 400 },
  { price: 520_473n, quantity: 300 },
];

const traceEnabled = process.env["CMI_E2E_TRACE"] === "1";

function trace(event: string, details: Record<string, unknown> = {}): void {
  if (!traceEnabled) return;
  console.info(`[CMI E2E] ${new Date().toISOString()} ${event} ${JSON.stringify(details)}`);
}

describe.skipIf(!enabled)(`E2E na rede ${NETWORK}`, () => {
  let service: Service;
  let base: string;
  let chain: ChainClient;
  let lines: string[];
  const ac = new AbortController();
  let loop: Promise<void>;
  let config: ServiceConfig;

  beforeAll(async () => {
    setTestNetwork(NET);
    const deployment = parseDeployment(JSON.parse(readFileSync(DEPLOYMENT, "utf8")));
    trace("deployment loaded", { network: NETWORK, rpcUrl: deployment.rpcUrl, factory: deployment.contracts.factory });
    const dir = mkdtempSync(join(tmpdir(), "cmi-operator-e2e-"));
    const masterHex = "44".repeat(32);
    writeFileSync(join(dir, "master.key"), masterHex, { mode: 0o600 });
    config = { ...testConfig({ secondsPerLedger: NET.secondsPerLedger, loopIntervalMs: NET.secondsPerLedger * 1_000 }), network: NETWORK, deployment, db: { path: join(dir, "operator.db") }, masterKey: { file: join(dir, "master.key") } };

    const db = openDb(config.db.path);
    const keys = new DbOperatorKeyStore(repos(db).keys, loadMasterKey({ hex: masterHex }));
    const configuredSpender = process.env["CMI_E2E_SPENDER_KEY"];
    keys.put("spender", new Secret(configuredSpender ?? generateKey("spender")));
    keys.put("envelope", new Secret(POC_ENVELOPE_SCALAR.toString(16)));
    keys.put("submitter", new Secret(generateKey("submitter")));
    await fundAccount(keys.publicOf("submitter"));
    trace("temporary keeper funded", { submitter: keys.publicOf("submitter"), spender: configuredSpender === undefined ? "ephemeral" : "deployment-matched" });
    db.close();

    const log = memoryLogger();
    lines = log.lines;
    const ports = connectChain(config);
    service = await buildService({ config, logger: log.logger, ports, prover: connectProver(config) });
    loop = service.loop.run(ac.signal);
    await service.api.listen({ host: "127.0.0.1", port: 0 });
    const addr = service.api.server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr !== null ? addr.port : 0}`;
    chain = new ChainClient({ rpcUrl: deployment.rpcUrl, networkPassphrase: deployment.networkPassphrase, allowHttp: true });
    trace("keeper started", { api: base });
  });

  afterAll(async () => {
    ac.abort();
    await loop;
    await service?.close();
  });

  const api = async (path: string): Promise<Record<string, unknown>> => (await fetch(`${base}${path}`, { headers: { "x-api-key": READ_KEY } })).json() as Promise<Record<string, unknown>>;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function until(what: string, cond: () => Promise<boolean>, timeoutMs = NETWORK === "testnet" ? 3_600_000 : 600_000): Promise<void> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await cond()) return;
      await sleep(NET.secondsPerLedger * 1_000);
    }
    throw new Error(`timeout: ${what}`);
  }

  async function auction(bids: readonly { price: bigint; quantity: number }[], opts: { revokeLast?: boolean } = {}) {
    const contracts = { factory: config.deployment.contracts.factory, token: config.deployment.contracts.token, auditor: config.deployment.contracts.auditor };
    const prover = connectProver(config);
    const sellerKp = Keypair.random();
    await fundAccount(sellerKp.publicKey());
    trace("seller funded", { seller: sellerKp.publicKey() });
    const seller = connectClient({ chain, contracts, signer: keypairSigner(sellerKp.secret()), keys: new InMemoryKeyProvider(), prover, openings: new MemoryOpeningStore() });
    await seller.account.ensureRegistered();
    trace("seller confidential account registered");
    const supply = 1_000;
    const quota = await issueQuotaAsset({ holders: [{ kp: sellerKp, quotas: supply }] });
    const closeLedger = (await chain.latestLedger()) + 60 + bidWindow(bids.length);
    trace("quota asset issued", { sac: quota.sac, supply, closeLedger });

    const { marketId } = await seller.seller.createMarket(
      { quotaAsset: quota.sac, totalQuotas: supply, minPricePerQuota: 500n, closeLedger, eligibilityPolicy: null, feeReserve: 50_000_000n },
      {
        async forNextMarket() {
          const r = (await (await fetch(`${base}/v1/register-data`)).json()) as { marketId: string; address: string; registerData: string };
          return { marketId: BigInt(r.marketId), address: r.address, registerData: new Uint8Array(Buffer.from(r.registerData, "base64")) };
        },
      },
    );
    trace("market created", { marketId: marketId.toString(), closeLedger });
    await seller.seller.openMarket(marketId);
    trace("market opened; quotas locked", { marketId: marketId.toString() });
    const clients: CmiClient[] = [];
    for (const [index, b] of bids.entries()) {
      const kp = Keypair.random();
      await fundAccount(kp.publicKey());
      await addTrustline(kp, quota.asset);
      const c = connectClient({ chain, contracts, signer: keypairSigner(kp.secret()), keys: new InMemoryKeyProvider(), prover, openings: new MemoryOpeningStore() });
      await c.account.ensureRegistered();
      await c.account.deposit(b.price * BigInt(b.quantity) + 1_234n);
      await c.account.merge();
      trace("bidder funded and registered", { bidder: index + 1, address: kp.publicKey(), quantity: b.quantity });
      await c.bidder.placeBid(await c.bidder.prepareBid(marketId, b.price, b.quantity));
      trace("bid validity proof accepted", { marketId: marketId.toString(), bidder: index + 1 });
      clients.push(c);
    }
    if (opts.revokeLast === true) {
      await clients.at(-1)!.bidder.recoverCollateral(marketId);
      trace("last bidder revoked collateral", { marketId: marketId.toString() });
    }
    await prover.destroy();
    return { marketId, closeLedger };
  }

  it("discovers, closes, finalizes and settles Aurora by itself; one settle per ledger; no price anywhere", async () => {
    const { marketId, closeLedger } = await auction(PRICES, { revokeLast: true });
    await until("discovered", async () => (await api(`/v1/markets/${marketId}`))["status"] !== undefined);
    trace("market discovered by keeper", { marketId: marketId.toString() });
    await until("settled", async () => (await api(`/v1/markets/${marketId}`))["status"] === "Settled");

    const m = await api(`/v1/markets/${marketId}`);
    expect(m["allocation"]).toEqual([200, 500, 300, 0]);
    const bids = m["bids"] as { status: string }[];
    expect(bids.map((b) => b.status)).toEqual(["Settled", "Settled", "Settled", "Failed"]);
    const actions = ((await api(`/v1/markets/${marketId}/actions?limit=50`))["items"] as { kind: string; ledger: number; outcome: string; txHash: string | null }[]).reverse();
    expect(actions.find((a) => a.kind === "close")!.ledger).toBeGreaterThanOrEqual(closeLedger);
    const settles = actions.filter((a) => a.kind === "settle" && a.outcome === "ok");
    expect(settles).toHaveLength(3);
    expect(new Set(settles.map((a) => a.ledger)).size).toBe(3);
    expect(actions.every((a) => a.outcome !== "ok" || a.txHash !== null)).toBe(true);
    trace("market settled", {
      marketId: marketId.toString(),
      closeLedger,
      allocation: m["allocation"],
      actions: actions.map((a) => ({ kind: a.kind, ledger: a.ledger, outcome: a.outcome, txHash: a.txHash })),
    });

    const secrets = PRICES.map((p) => p.price);
    const bodies = await Promise.all(["/v1/status", `/v1/markets/${marketId}`, `/v1/markets/${marketId}/actions`, "/v1/alerts"].map(async (p) => JSON.stringify(await api(p))));
    assertNoSecretLeak(secrets, [...lines, ...bodies, ...["markets", "bids", "actions", "alerts", "meta"].map((t) => JSON.stringify(service.db.prepare(`SELECT * FROM ${t}`).all()))]);
  });

  it("timeout: paused past finalize_by_ledger → cancel_expired and full refunds when resumed", async (ctx) => {
    const { marketId } = await auction(PRICES.slice(0, 2));
    await until("discovered", async () => (await api(`/v1/markets/${marketId}`))["finalizeByLedger"] !== undefined);
    const m0 = await api(`/v1/markets/${marketId}`);

    if ((m0["finalizeByLedger"] as number) - (m0["closeLedger"] as number) > MAX_GRACE_FOR_TIMEOUT) ctx.skip();
    await until("closed", async () => (await api(`/v1/markets/${marketId}`))["status"] === "Closed");
    trace("market closed; pausing keeper for timeout path", { marketId: marketId.toString() });
    await fetch(`${base}/v1/keeper/pause`, { method: "POST", headers: { "x-api-key": ADMIN_KEY } });
    const finalizeBy = (await api(`/v1/markets/${marketId}`))["finalizeByLedger"] as number;
    await until("past finalize_by", async () => (await chain.latestLedger()) > finalizeBy);
    await fetch(`${base}/v1/keeper/resume`, { method: "POST", headers: { "x-api-key": ADMIN_KEY } });
    await until("refunded", async () => ((await api(`/v1/markets/${marketId}`))["bids"] as { status: string }[]).every((b) => b.status !== "Pending"));
    expect((await api(`/v1/markets/${marketId}`))["status"]).toBe("Cancelled");
    const alerts = (await api("/v1/alerts?limit=100"))["items"] as { kind: string; marketId: string | null }[];
    expect(alerts.some((a) => a.kind === "TimedOut" && a.marketId === String(marketId))).toBe(true);
    trace("timeout refunds completed", { marketId: marketId.toString() });
  });
});
