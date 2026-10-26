import { Keypair, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import {
  CmiError,
  QUOTA_UNIT,
  Secret,
  chainAuctionPort,
  chainTokenPort,
  cryptoRng,
  decodeSpenderTransferData,
  keypairSigner,
  settlementAmounts,
  silentLogger,
  type Prover,
} from "@zolvency-cmi/core";
import { InMemoryKeyProvider, MemoryOpeningStore, connectClient, type CmiClient } from "@zolvency-cmi/client";
import { CmiOperator, InMemoryOperatorKeyStore, buildSettlementLegs } from "@zolvency-cmi/operator";
import { addTrustline, bidWindow, fundAccount, issueQuotaAsset, type LocalDeployment } from "@zolvency-cmi/testing";

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

async function rejects(p: Promise<unknown>, code: string): Promise<CmiError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof CmiError && e.code === code) return e;
    const got = e instanceof CmiError ? e.code : "UnexpectedError";
    throw new CheckFailure(got, `expected ${code}, got ${got}`);
  }
  throw new CheckFailure("UnexpectedSuccess", `expected ${code}, got success`);
}

const BIDS = [
  { name: "Eva", price: 700n, quantity: 100 },
  { name: "Ana", price: 650n, quantity: 200 },
  { name: "Bruno", price: 600n, quantity: 500 },
  { name: "Carla", price: 580n, quantity: 400 },
  { name: "Diego", price: 520n, quantity: 300 },
] as const;
const FILLED = [100, 200, 500, 200, 0];
const [EVA, ANA, BRUNO, CARLA, DIEGO] = [0, 1, 2, 3, 4] as const;
const SETTLE_CPU_LIMIT = 400_000_000;

export async function runRc2(env: Env): Promise<CheckOutcome[]> {
  const { chain, dep, prover, say } = env;
  const contracts = { factory: dep.contracts.factory, token: dep.contracts.token, auditor: dep.contracts.auditor };
  const outcomes: CheckOutcome[] = [];

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
  const quota = await issueQuotaAsset({ holders: [{ kp: sellerKp, quotas: 1_000 }] });
  const quotaBalance = async (who: string): Promise<bigint> =>
    BigInt(scValToNative(await chain.simulate(quota.sac, "balance", [nativeToScVal(who, { type: "address" })])) as bigint);
  const keys = new InMemoryOperatorKeyStore({ spenderKey: new Secret(cryptoRng.scalar()), envelopeKey: new Secret(987_654_321_098n), submitter });
  const operator = new CmiOperator({ keys, factory: seller.factory, tokenAddress: dep.contracts.token, prover, auction: (address) => chainAuctionPort({ chain, address }), token });

  say("== setup: mercado de settlement (1.000 cotas, piso 500, 5 bids) ==");

  const closeLedger = (await chain.latestLedger()) + bidWindow(BIDS.length);
  const { marketId, address } = await seller.seller.createMarket(
    { quotaAsset: quota.sac, totalQuotas: 1_000, minPricePerQuota: 500n, closeLedger, eligibilityPolicy: null, feeReserve: 50_000_000n },
    { forNextMarket: () => operator.registerDataForNextMarket() },
  );
  await seller.seller.openMarket(marketId);
  const auction = chainAuctionPort({ chain, address });

  const bidders: { kp: Keypair; client: CmiClient }[] = [];
  for (const b of BIDS) {
    const kp = Keypair.random();
    await fundAccount(kp.publicKey());
    await addTrustline(kp, quota.asset);
    const client = connectClient({ chain, contracts, signer: keypairSigner(kp.secret()), keys: new InMemoryKeyProvider(), prover, openings: new MemoryOpeningStore() });
    await client.account.ensureRegistered();
    await client.account.deposit(b.price * BigInt(b.quantity));
    await client.account.merge();
    await client.bidder.placeBid(await client.bidder.prepareBid(marketId, b.price, b.quantity));
    bidders.push({ kp, client });
    say(`   ${b.name}: ${b.quantity} cotas`);
  }

  await bidders[EVA]!.client.bidder.recoverCollateral(marketId);

  say(`   esperando o close_ledger ${closeLedger}`);
  while ((await chain.latestLedger()) < closeLedger) await new Promise((r) => setTimeout(r, 2_000));
  await auction.closeMarket(submitter);
  const { filled, proof } = await operator.proveAllocation(await operator.planAllocation(address));
  assert(filled.join(",") === FILLED.join(","), `allocation ${filled.join(",")}`);
  await auction.finalize(submitter, filled, proof);
  say(`   finalize: ${filled.join(", ")}`);

  const settleTxs: { hash: string; cpu: number }[] = [];
  async function settle(i: number): Promise<{ tx: string; cpu: number }> {
    const p = await operator.buildSettlement(address, i);
    const outcome = await auction.settle(submitter, i, p, p.proof);
    assert(outcome === "Settled", `settle(${i}) returned ${outcome}`);
    const t = chain.last("settle");
    settleTxs.push({ hash: t.hash, cpu: t.cpuInsns });
    return { tx: t.hash, cpu: t.cpuInsns };
  }
  const legsParams = async (i: number) => ({
    auction,
    token,
    tokenAddress: dep.contracts.token,
    spenderKey: await keys.spenderKey(),
    envelopeKey: await keys.envelopeKey(),
    prover,
    bidIndex: i,
    logger: silentLogger,
  });

  await check("RF-20.settle_partial", async () => {
    const r = await settle(CARLA);
    assert((await auction.getSettlementStatus(CARLA)) === "Settled", "Carla's bid is Settled");
    assert((await quotaBalance(bidders[CARLA]!.kp.publicKey())) === 200n * QUOTA_UNIT, "Carla got her 200 quotas");
    const v = await bidders[CARLA]!.client.bidder.status(marketId);
    assert(v.refund === 580n * 200n, "Carla's refund is 580 × (400 − 200)");
    return r;
  });

  await check("RF-20.settle_full", async () => {
    const r = await settle(ANA);
    assert((await quotaBalance(bidders[ANA]!.kp.publicKey())) === 200n * QUOTA_UNIT, "Ana got her 200 quotas");
    assert((await bidders[ANA]!.client.bidder.status(marketId)).refund === 0n, "Ana has no refund");
    const paid = (await seller.seller.proceeds(marketId)).find((x) => x.bidIndex === ANA);
    assert(paid?.received === 117_000n, "the seller received 90% of 650 × 200");
    return r;
  });

  await check("RF-20.settle_zero", async () => {
    const r = await settle(DIEGO);
    assert((await quotaBalance(bidders[DIEGO]!.kp.publicKey())) === 0n, "Diego got no quota");
    assert((await bidders[DIEGO]!.client.bidder.status(marketId)).refund === 520n * 300n, "Diego got all his collateral back");
    return r;
  });

  const bruno = settlementAmounts(600n, 500, 500).expose();
  await check("RF-20.fee_skipped_rejected", async () => {
    const honest = await operator.buildSettlement(address, BRUNO);
    const bad = await buildSettlementLegs(await legsParams(BRUNO), { seller: bruno.gross, fee: 0n, refund: 0n });
    await rejects(auction.settle(submitter, BRUNO, bad, honest.proof), "Auction.InvalidSettlementProof");
    assert((await auction.getSettlementStatus(BRUNO)) === "Pending", "Bruno's bid is still Pending");
    return {};
  });

  await check("RF-20.fee_20pct_rejected", async () => {
    const honest = await operator.buildSettlement(address, BRUNO);
    const fee20 = (bruno.gross * 2_000n) / 10_000n;
    const bad = await buildSettlementLegs(await legsParams(BRUNO), { seller: bruno.gross - fee20, fee: fee20, refund: 0n });
    await rejects(auction.settle(submitter, BRUNO, bad, honest.proof), "Auction.InvalidSettlementProof");
    assert((await auction.getSettlementStatus(BRUNO)) === "Pending", "Bruno's bid is still Pending");
    return {};
  });

  await check("RF-20.leg_rollback", async () => {
    const honest = await operator.buildSettlement(address, BRUNO);

    const refundData = Uint8Array.from(honest.refundData);
    const last = refundData.length - 1;
    refundData[last] = (refundData[last] ?? 0) ^ 0x01;
    const decoded = decodeSpenderTransferData(refundData);
    assert(decoded.payload.cTx.x === decodeSpenderTransferData(honest.refundData).payload.cTx.x, "only the leg proof changed");
    const before = await token.delegation(bidders[BRUNO]!.kp.publicKey(), address);
    const sellerBefore = await token.account(sellerKp.publicKey());
    let failed = false;
    try {
      await auction.settle(submitter, BRUNO, { ...honest, refundData }, honest.proof);
    } catch {
      failed = true;
    }
    assert(failed, "the settle with a bad leg proof failed");
    const after = await token.delegation(bidders[BRUNO]!.kp.publicKey(), address);
    const sellerAfter = await token.account(sellerKp.publicKey());
    assert((await auction.getSettlementStatus(BRUNO)) === "Pending", "Bruno's bid is still Pending");
    assert(before !== null && after !== null && before.allowanceCommitment.x === after.allowanceCommitment.x && before.allowanceSalt === after.allowanceSalt, "the allowance did not move");
    assert(sellerBefore!.receivingBalance.x === sellerAfter!.receivingBalance.x, "the seller received nothing");

    return settle(BRUNO);
  });

  await check("RF-20.release_after_real_revocation", async () => {
    assert(!(await token.isSpender(bidders[EVA]!.kp.publicKey(), address)), "Eva's delegation is gone");
    const sellerQuotas = await quotaBalance(sellerKp.publicKey());
    await rejects(operator.buildSettlement(address, EVA), "Token.DelegationNotFound");
    await auction.releaseUnsettled(submitter, EVA);
    assert((await auction.getSettlementStatus(EVA)) === "Failed", "Eva's bid is Failed");
    assert((await quotaBalance(sellerKp.publicKey())) === sellerQuotas + 100n * QUOTA_UNIT, "Eva's 100 quotas went back to the seller");
    assert((await auction.getState()) === "Settled", "every bid is closed: the market is Settled");
    return { tx: chain.last("release_unsettled").hash };
  });

  await check("RF-20.settle_cpu_under_400m", async () => {
    assert(settleTxs.length >= 3, "the settles above ran");
    const worst = settleTxs.reduce((a, b) => (b.cpu > a.cpu ? b : a));
    assert(worst.cpu > 0 && worst.cpu < SETTLE_CPU_LIMIT, `settle cpu ${worst.cpu} < 400M`);
    return { tx: worst.hash, cpu: worst.cpu };
  });

  return outcomes;
}
