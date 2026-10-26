import { Keypair } from "@stellar/stellar-sdk";
import {
  CmiError,
  SETTLEMENT_MARGIN_LEDGERS,
  Secret,
  addressToField,
  buildSetSpenderWitness,
  cryptoRng,
  deriveTokenKeys,
  encodeSetSpenderData,
  keypairSigner,
  type Point,
  type Prover,
  type Signer,
} from "@zolvency-cmi/core";
import { InMemoryKeyProvider, MemoryOpeningStore, connectClient, verifiedOpenings, type CmiClient, type PreparedBid } from "@zolvency-cmi/client";
import { CmiOperator, InMemoryOperatorKeyStore } from "@zolvency-cmi/operator";
import { addTrustline, bidWindow, fundAccount, issueQuotaAsset, ledgersFor, type LocalDeployment, type QuotaAsset } from "@zolvency-cmi/testing";

import type { RecordingChain } from "../chain.js";
import type { CheckOutcome } from "../evidence.js";

interface Env {
  chain: RecordingChain;
  dep: LocalDeployment;
  prover: Prover;
  say: (msg: string) => void;
}

interface Bidder {
  kp: Keypair;
  signer: Signer;
  client: CmiClient;
  openings: MemoryOpeningStore;
  keys: InMemoryKeyProvider;
}

const DEPOSIT = 300_000n;
const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

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

export async function runRc1(env: Env): Promise<CheckOutcome[]> {
  const { chain, dep, prover, say } = env;
  const contracts = { factory: dep.contracts.factory, token: dep.contracts.token, auditor: dep.contracts.auditor };
  const tokenAddrF = addressToField(dep.contracts.token);
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

  const skOp = cryptoRng.scalar();
  const opSubmitter = Keypair.random();
  const sellerKp = Keypair.random();
  await Promise.all([fundAccount(opSubmitter.publicKey()), fundAccount(sellerKp.publicKey())]);
  const quota: QuotaAsset = await issueQuotaAsset({ holders: [{ kp: sellerKp, quotas: 2_000 }] });
  const operator = new CmiOperator({
    keys: new InMemoryOperatorKeyStore({ spenderKey: new Secret(skOp), envelopeKey: new Secret(987_654_321_098n), submitter: keypairSigner(opSubmitter.secret()) }),
    factory: connectClient({ chain, contracts, signer: keypairSigner(sellerKp.secret()), keys: new InMemoryKeyProvider(), prover }).factory,
    tokenAddress: dep.contracts.token,
    prover,
  });
  const seller = connectClient({ chain, contracts, signer: keypairSigner(sellerKp.secret()), keys: new InMemoryKeyProvider(), prover });

  await seller.account.ensureRegistered();

  async function market(totalQuotas: number, closeIn: number): Promise<{ marketId: bigint; address: string; closeLedger: number }> {
    const closeLedger = (await chain.latestLedger()) + closeIn;
    const m = await seller.seller.createMarket(
      { quotaAsset: quota.sac, totalQuotas, minPricePerQuota: 500n, closeLedger, eligibilityPolicy: null, feeReserve: 50_000_000n },

      { forNextMarket: () => operator.registerDataForNextMarket() },
    );
    await seller.seller.openMarket(m.marketId);
    return { ...m, closeLedger };
  }

  async function newBidder(): Promise<Bidder> {
    const kp = Keypair.random();
    await fundAccount(kp.publicKey());
    await addTrustline(kp, quota.asset);
    const openings = new MemoryOpeningStore();
    const keys = new InMemoryKeyProvider();
    const signer = keypairSigner(kp.secret());
    const client = connectClient({ chain, contracts, signer, keys, prover, openings });
    await client.account.ensureRegistered();
    await client.account.deposit(DEPOSIT);
    await client.account.merge();
    return { kp, signer, client, openings, keys };
  }

  async function rawLock(b: Bidder, auction: string, liveUntil: number, data: Uint8Array, next: { v: bigint; r: bigint }): Promise<string> {
    const acc = (await b.client.token.account(b.kp.publicKey()))!;
    const o = await verifiedOpenings(b.openings, b.kp.publicKey(), tokenAddrF, acc);
    await b.client.token.setSpender(b.signer, auction, liveUntil, data);
    await b.openings.put(b.kp.publicKey(), tokenAddrF, new Secret({ ...o.expose(), spendable: next }));
    return chain.last("set_spender", b.kp.publicKey()).hash;
  }

  say("== setup: mercado A (1.000 cotas, piso 500) ==");
  const A = await market(1_000, ledgersFor(900));

  const grace = (await seller.auctionAt(A.address).getMarket()).finalizationGraceLedgers;
  const required = A.closeLedger + grace + SETTLEMENT_MARGIN_LEDGERS;

  await check("RF-08.auction_registers_in_real_token", async () => {
    const acc = await seller.token.account(A.address);
    assert(acc !== null, "the auction has a confidential account");
    assert(same(acc.spendingKey, deriveTokenKeys(skOp, tokenAddrF).Y), "the auction registered Y_op of the operator");
    return { tx: chain.last("create_market").hash };
  });

  let b1: Bidder | undefined;
  let ana: PreparedBid | undefined;
  await check("RF-09.lock_real_set_spender", async () => {
    b1 = await newBidder();
    ana = await b1.client.bidder.prepareBid(A.marketId, 650n, 200);
    await b1.client.bidder.placeBid(ana).catch(() => undefined);
    const d = await b1.client.token.delegation(b1.kp.publicKey(), A.address);
    assert(d !== null && same(d.allowanceCommitment, ana.setSpender.cA), "on-chain C_a is the prepared one");
    assert(await b1.client.token.isSpender(b1.kp.publicKey(), A.address), "is_spender(bidder, auction)");
    return { tx: chain.last("set_spender", b1.kp.publicKey()).hash };
  });

  await check("RF-11.submit_bid_real_ca_accepted", async () => {
    assert(b1 !== undefined && ana !== undefined, "check 2 prepared the bid");
    const tx = chain.last("submit_bid", b1.kp.publicKey());
    const record = await b1.client.auctionAt(A.address).getBidRecord(0);
    assert(record.bidder === b1.kp.publicKey() && record.commitment === ana.submission.commitment, "the bid record is the submitted one");
    return { tx: tx.hash, cpu: tx.cpuInsns };
  });

  await check("RF-14.ca_of_other_value_rejected", async () => {
    const b2 = await newBidder();
    const p = await b2.client.bidder.prepareBid(A.marketId, 650n, 200);
    const acc = (await b2.client.token.account(b2.kp.publicKey()))!;
    const o = await verifiedOpenings(b2.openings, b2.kp.publicKey(), tokenAddrF, acc);
    const auctionAcc = (await b2.client.token.account(A.address))!;
    const myKeys = (await b2.keys.get(b2.kp.publicKey(), tokenAddrF))!;
    const w = buildSetSpenderWitness({
      keys: myKeys,
      spend: new Secret(o.expose().spendable),
      vA: 650n * 200n + 1n,
      yOp: auctionAcc.spendingKey,
      opI: addressToField(A.address),
      kAudS: await b2.client.token.auditorKey(acc.auditorId),
    });
    const { proof } = await prover.prove("set_spender", w.inputs);
    const tx = await rawLock(b2, A.address, p.setSpender.liveUntilLedger, encodeSetSpenderData(w, proof), w.next.expose());
    await rejects(b2.client.auctionAt(A.address).submitBid(b2.signer, p.submission), "Auction.InvalidBidProof");
    await b2.client.bidder.recoverCollateral(A.marketId);
    return { tx };
  });

  await check("RF-14.short_live_until_rejected", async () => {
    const b3 = await newBidder();
    const p = await b3.client.bidder.prepareBid(A.marketId, 650n, 200);
    const tx = await rawLock(b3, A.address, required - 1, p.setSpender.data, p.secrets.expose().next);
    await rejects(b3.client.auctionAt(A.address).submitBid(b3.signer, p.submission), "Auction.CollateralExpiresTooSoon");
    await b3.client.bidder.recoverCollateral(A.marketId);
    return { tx };
  });

  await check("RF-09.revocation_detected", async () => {
    const b4 = await newBidder();
    const p = await b4.client.bidder.prepareBid(A.marketId, 650n, 200);
    await rawLock(b4, A.address, p.setSpender.liveUntilLedger, p.setSpender.data, p.secrets.expose().next);
    await b4.client.bidder.recoverCollateral(A.marketId);
    assert(!(await b4.client.token.isSpender(b4.kp.publicKey(), A.address)), "is_spender is false after revoke");
    await rejects(b4.client.auctionAt(A.address).submitBid(b4.signer, p.submission), "Auction.NoCollateral");
    return { tx: chain.last("revoke_spender", b4.kp.publicKey()).hash };
  });

  await check("RF-09.second_set_spender_fails_with_clear_sdk_error", async () => {
    const b5 = await newBidder();
    const first = await b5.client.bidder.prepareBid(A.marketId, 650n, 100);
    const tx = await rawLock(b5, A.address, first.setSpender.liveUntilLedger, first.setSpender.data, first.secrets.expose().next);
    const second = await b5.client.bidder.prepareBid(A.marketId, 700n, 100);
    const before = chain.countBy(b5.kp.publicKey());

    const sdk = await rejects(b5.client.bidder.placeBid(second), "Token.DelegationAlreadyExists");
    assert(sdk.recovery === "revoke_spender" && /revoke/i.test(sdk.message), "the SDK error says to revoke first");
    assert(chain.countBy(b5.kp.publicKey()) === before, "the SDK sent nothing");

    await rejects(b5.client.token.setSpender(b5.signer, A.address, second.setSpender.liveUntilLedger, second.setSpender.data), "Token.DelegationAlreadyExists");
    await b5.client.bidder.recoverCollateral(A.marketId);
    return { tx };
  });

  await check("RF-11.below_min_creates_no_delegation", async () => {
    const b6 = await newBidder();
    const before = chain.countBy(b6.kp.publicKey());
    await rejects(b6.client.bidder.prepareBid(A.marketId, 499n, 10), "BelowMinPrice");
    assert(chain.countBy(b6.kp.publicKey()) === before, "no transaction was sent");
    assert((await b6.client.token.delegation(b6.kp.publicKey(), A.address)) === null, "no delegation exists");
    assert(!(await b6.client.token.isSpender(b6.kp.publicKey(), A.address)), "is_spender is false");
    return {};
  });

  await check("RF-09.rejected_after_lock_revoke_returns_funds", async () => {
    const b7 = await newBidder();
    say("   mercado C, fechando depois de um lance");
    const C = await market(10, bidWindow(1) + ledgersFor(30));
    const p = await b7.client.bidder.prepareBid(C.marketId, 650n, 10);
    while ((await chain.latestLedger()) < C.closeLedger) await new Promise((r) => setTimeout(r, 2_000));
    const err = await rejects(b7.client.bidder.placeBid(p), "Auction.BiddingClosed");
    assert(err.recovery === "revoke_spender", "the error after the lock carries recovery revoke_spender");
    assert(await b7.client.token.isSpender(b7.kp.publicKey(), C.address), "the collateral is still locked");
    await b7.client.bidder.recoverCollateral(C.marketId);
    assert(!(await b7.client.token.isSpender(b7.kp.publicKey(), C.address)), "is_spender is false after revoke");
    const bal = await b7.client.account.balance();
    assert(bal.spendable === DEPOSIT, "the spendable balance is back to the deposit");
    return { tx: chain.last("revoke_spender", b7.kp.publicKey()).hash };
  });

  return outcomes;
}
