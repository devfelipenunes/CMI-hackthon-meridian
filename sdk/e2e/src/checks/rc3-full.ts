import { Keypair, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { InMemoryKeyProvider, MemoryOpeningStore, connectClient, type CmiClient, type MarketEvent } from "@zolvency-cmi/client";
import { CmiError, QUOTA_UNIT, Secret, chainAuctionPort, chainTokenPort, cryptoRng, keypairSigner, settlementAmounts, type Prover } from "@zolvency-cmi/core";
import { CmiOperator, InMemoryOperatorKeyStore, Keeper, type KeeperEvent } from "@zolvency-cmi/operator";
import { addTrustline, bidWindow, fundAccount, issueQuotaAsset, type LocalDeployment, type QuotaAsset } from "@zolvency-cmi/testing";

import type { RecordingChain } from "../chain.js";
import type { CheckOutcome } from "../evidence.js";

interface Env {
  chain: RecordingChain;
  dep: LocalDeployment;
  prover: Prover;
  say: (msg: string) => void;
}

class CheckFailure extends Error {
  constructor(
    readonly got: string,
    detail: string,
  ) {
    super(detail);
  }
}

function assert(cond: boolean, what: string): asserts cond {
  if (!cond) throw new CheckFailure("AssertionFailed", `assertion failed: ${what}`);
}

const FULL = {
  supply: 1_200,
  bids: [
    { price: 650n, quantity: 200 },
    { price: 620n, quantity: 150 },
    { price: 600n, quantity: 300 },
    { price: 590n, quantity: 250 },
    { price: 580n, quantity: 400 },
    { price: 580n, quantity: 400 },
    { price: 570n, quantity: 100 },
    { price: 560n, quantity: 100 },
  ],
  filled: [200, 150, 300, 250, 300, 0, 0, 0],
};
const TIMEOUT = { supply: 500, bids: [{ price: 650n, quantity: 100 }, { price: 600n, quantity: 100 }, { price: 550n, quantity: 100 }] };

export async function runRc3(env: Env): Promise<CheckOutcome[]> {
  const { chain, dep, prover, say } = env;
  const contracts = { factory: dep.contracts.factory, token: dep.contracts.token, auditor: dep.contracts.auditor };
  const outcomes: CheckOutcome[] = [];
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  async function check(id: string, run: () => Promise<{ tx?: string; cpu?: number }>): Promise<void> {
    say(`-- ${id}`);
    try {
      const r = await run();
      outcomes.push({ id, result: "PASS", ...r });
      say(`   PASS${r.tx === undefined ? "" : ` tx ${r.tx}`}${r.cpu === undefined ? "" : ` cpu ${r.cpu}`}`);
    } catch (e) {
      const error = e instanceof CheckFailure ? e.got : e instanceof CmiError ? e.code : "UnexpectedError";
      outcomes.push({ id, result: "FAIL", error });
      say(`   FAIL ${error}${e instanceof Error ? ` (${e.message})` : ""}`);
    }
  }

  const submitterKp = Keypair.random();
  const sellerKp = Keypair.random();
  await Promise.all([fundAccount(submitterKp.publicKey()), fundAccount(sellerKp.publicKey())]);
  const submitter = keypairSigner(submitterKp.secret());
  const token = chainTokenPort({ chain, token: dep.contracts.token, auditor: dep.contracts.auditor });
  const seller = connectClient({ chain, contracts, signer: keypairSigner(sellerKp.secret()), keys: new InMemoryKeyProvider(), prover, openings: new MemoryOpeningStore() });
  await seller.account.ensureRegistered();
  const operator = new CmiOperator({
    keys: new InMemoryOperatorKeyStore({ spenderKey: new Secret(cryptoRng.scalar()), envelopeKey: new Secret(987_654_321_098n), submitter }),
    factory: seller.factory,
    tokenAddress: dep.contracts.token,
    prover,
    auction: (address) => chainAuctionPort({ chain, address }),
    token,
  });
  const keeperEvents: KeeperEvent[] = [];
  const keeper = new Keeper(operator, { clock: { ledger: () => chain.latestLedger() }, onEvent: (e) => keeperEvents.push(e) });
  const balanceOf = (quota: QuotaAsset) => async (who: string): Promise<bigint> =>
    BigInt(scValToNative(await chain.simulate(quota.sac, "balance", [nativeToScVal(who, { type: "address" })])) as bigint);

  async function market(name: string, supply: number, closeIn: number, bids: readonly { price: bigint; quantity: number }[]) {
    const quota = await issueQuotaAsset({ holders: [{ kp: sellerKp, quotas: supply }] });
    const startLedger = await chain.latestLedger();
    const closeLedger = startLedger + closeIn;
    const { marketId, address } = await seller.seller.createMarket(
      { quotaAsset: quota.sac, totalQuotas: supply, minPricePerQuota: 500n, closeLedger, eligibilityPolicy: null, feeReserve: 50_000_000n },
      { forNextMarket: () => operator.registerDataForNextMarket() },
    );
    await seller.seller.openMarket(marketId);
    const bidders: { kp: Keypair; client: CmiClient }[] = [];
    for (const b of bids) {
      const kp = Keypair.random();
      await fundAccount(kp.publicKey());
      await addTrustline(kp, quota.asset);
      const client = connectClient({ chain, contracts, signer: keypairSigner(kp.secret()), keys: new InMemoryKeyProvider(), prover, openings: new MemoryOpeningStore() });
      await client.account.ensureRegistered();
      await client.account.deposit(b.price * BigInt(b.quantity));
      await client.account.merge();
      await client.bidder.placeBid(await client.bidder.prepareBid(marketId, b.price, b.quantity));
      bidders.push({ kp, client });
    }
    say(`   ${name}: market ${marketId}, ${bids.length} bids, close_ledger ${closeLedger}`);
    return { marketId, address, startLedger, closeLedger, bidders, quota, balance: balanceOf(quota), auction: chainAuctionPort({ chain, address }) };
  }

  async function keep(address: string, maxTicks = 200): Promise<void> {
    for (let i = 0; i < maxTicks; i++) {
      const a = await keeper.tick(address);
      if (a.kind === "done") return;
      if (a.kind === "wait") await sleep(1_000);
    }
    throw new CheckFailure("KeeperDidNotFinish", `the keeper did not finish ${address}`);
  }

  async function events(m: { marketId: bigint; startLedger: number }): Promise<MarketEvent[]> {
    const out: MarketEvent[] = [];
    for await (const e of seller.markets.watch(m.marketId, { fromLedger: m.startLedger, pollIntervalMs: 1_000, signal: AbortSignal.timeout(60_000) })) out.push(e);
    return out;
  }

  say("== setup: mercado do timeout primeiro (a janela de finalização corre durante o resto) ==");

  const T = await market("timeout", TIMEOUT.supply, bidWindow(TIMEOUT.bids.length), TIMEOUT.bids);
  say("== setup: o leilão completo de 8 lances ==");
  const F = await market("full", FULL.supply, bidWindow(FULL.bids.length), FULL.bids);

  await check("MVP.full_auction_8_bids_settled", async () => {

    while ((await chain.latestLedger()) < T.closeLedger) await sleep(2_000);
    await T.auction.closeMarket(submitter);
    while ((await chain.latestLedger()) < F.closeLedger) await sleep(2_000);
    await keep(F.address);

    const view = await seller.markets.get(F.marketId);
    assert(view.status === "Settled", `market status ${view.status}`);
    assert(JSON.stringify(view.allocation) === JSON.stringify(FULL.filled), `allocation ${JSON.stringify(view.allocation)}`);
    assert(view.demand === FULL.bids.reduce((s, b) => s + b.quantity, 0), "public demand");
    for (const [i, b] of FULL.bids.entries()) {
      const filled = FULL.filled[i]!;
      assert((await F.balance(F.bidders[i]!.kp.publicKey())) === BigInt(filled) * QUOTA_UNIT, `bidder ${i} quotas`);
      const s = await F.bidders[i]!.client.bidder.status(F.marketId);
      assert(s.status === "Settled" && s.filled === filled && s.refund === b.price * BigInt(b.quantity - filled), `bidder ${i} status/refund`);
    }
    const paid = await seller.seller.proceeds(F.marketId);
    const expected = FULL.bids.flatMap((b, i) => (FULL.filled[i]! > 0 ? [{ bidIndex: i, filled: FULL.filled[i]!, received: settlementAmounts(b.price, b.quantity, FULL.filled[i]!).expose().seller }] : []));
    assert(JSON.stringify(paid, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)) === JSON.stringify(expected, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)), "seller proceeds");
    const evs = await events(F);
    assert(evs.filter((e) => e.kind === "BidSettled").length === 8 && evs.at(-1)?.kind === "MarketSettled", "events: 8 BidSettled then MarketSettled");
    const settles = chain.txs.filter((t) => t.method === "settle" && t.contract === F.address);
    assert(settles.length === 8 && new Set(settles.map((t) => t.hash)).size === 8, "8 settle transactions");
    const worst = settles.reduce((a, b) => (b.cpuInsns > a.cpuInsns ? b : a));
    return { tx: worst.hash, cpu: worst.cpuInsns };
  });

  await check("MVP.timeout_refunds", async () => {
    const finalizeBy = await T.auction.getFinalizeByLedger();
    assert(finalizeBy !== null, "the timeout market is Closed");
    let last = 0;
    for (;;) {
      const ledger = await chain.latestLedger();
      if (ledger > finalizeBy) break;
      if (ledger - last >= 1_800) {
        say(`   esperando o finalize_by_ledger ${finalizeBy}: ledger ${ledger}, faltam ${finalizeBy - ledger + 1}`);
        last = ledger;
      }
      await sleep(10_000);
    }
    await keep(T.address);

    assert((await T.auction.getState()) === "Cancelled", "the market is Cancelled");
    for (const [i, b] of TIMEOUT.bids.entries()) {
      const s = await T.bidders[i]!.client.bidder.status(T.marketId);
      assert(s.status === "Settled" && s.filled === 0 && s.refund === b.price * BigInt(b.quantity), `bidder ${i} got all the collateral back`);
      assert((await T.balance(T.bidders[i]!.kp.publicKey())) === 0n, `bidder ${i} got no quota`);
    }
    assert((await T.balance(sellerKp.publicKey())) === BigInt(TIMEOUT.supply) * QUOTA_UNIT, "every quota went back to the seller");
    const evs = await events(T);
    const cancelled = evs.find((e) => e.kind === "MarketCancelled");
    assert(cancelled?.kind === "MarketCancelled" && cancelled.reason === "timeout", "MarketCancelled(timeout)");
    assert(evs.filter((e) => e.kind === "BidSettled").length === 3 && evs.at(-1)?.kind === "MarketSettled", "3 refunds then the end event");
    assert(keeperEvents.some((e) => e.kind === "action" && e.action.kind === "cancel_expired"), "the keeper called cancel_expired");
    return { tx: chain.last("cancel_expired").hash };
  });

  return outcomes;
}
