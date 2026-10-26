import {
  FINALIZATION_GRACE_LEDGERS,
  MAX_BIDS,
  SETTLEMENT_MARGIN_LEDGERS,
  Secret,
  TTL_BUFFER_LEDGERS,
  pedersenCommit,
} from "@zolvency-cmi/core";
import { assertNoSecretLeak, fakeBidRecord } from "@zolvency-cmi/testing";
import { describe, expect, it } from "vitest";

import { CLOSE, DEPOSIT, bidderScenario } from "../helpers/bidder.js";

describe("BidderApi.prepareBid: preflight (RF-05, RF-11, RF-14)", () => {
  it("below min price throws BelowMinPrice and makes no call at all", async () => {
    const s = await bidderScenario();
    await expect(s.bidder.prepareBid(s.marketId, 499n, 10)).rejects.toMatchObject({ code: "BelowMinPrice" });

    expect(s.log.all()).toEqual(["factory.get_market_address", "auction.get_market"]);
    expect(s.log.writes()).toEqual([]);
  });

  it.each([
    ["price == 0", 0n],
    ["price ≥ 2^63", 1n << 63n],
  ])("PriceOutOfRange (%s) is local: no call at all", async (_n, price) => {
    const s = await bidderScenario();
    await expect(s.bidder.prepareBid(s.marketId, price, 10)).rejects.toMatchObject({ code: "PriceOutOfRange" });
    expect(s.log.all()).toEqual([]);
  });

  it("quantity 0 is refused locally (Auction.ZeroQuantity)", async () => {
    const s = await bidderScenario();
    await expect(s.bidder.prepareBid(s.marketId, 650n, 0)).rejects.toMatchObject({ code: "Auction.ZeroQuantity" });
    expect(s.log.all()).toEqual([]);
  });

  it("MarketNotOpen when the market is not Open", async () => {
    const s = await bidderScenario();
    s.clock.advanceTo(CLOSE);
    await s.auction.closeMarket(s.me);
    s.log.clear();
    await expect(s.bidder.prepareBid(s.marketId, 650n, 200)).rejects.toMatchObject({ code: "MarketNotOpen" });
    expect(s.log.writes()).toEqual([]);
  });

  it("BiddingClosed exactly at close_ledger, and close_ledger − 1 still passes the preflight", async () => {
    const s = await bidderScenario();
    s.clock.advanceTo(CLOSE);
    await expect(s.bidder.prepareBid(s.marketId, 650n, 200)).rejects.toMatchObject({ code: "BiddingClosed" });
    const t = await bidderScenario();
    t.clock.advanceTo(CLOSE - 1);
    await expect(t.bidder.prepareBid(t.marketId, 650n, 200)).resolves.toMatchObject({ marketId: t.marketId });
  });

  it("MarketFull with MAX_BIDS bids", async () => {
    const s = await bidderScenario();
    for (let i = 0; i < MAX_BIDS; i++) s.auction.seedBid(fakeBidRecord({ bidder: `GBIDDER${i}`, nullifier: BigInt(100 + i) }));
    await expect(s.bidder.prepareBid(s.marketId, 650n, 200)).rejects.toMatchObject({ code: "MarketFull" });
  });

  it("AlreadyBid when the bidder already has an accepted bid", async () => {
    const s = await bidderScenario();
    s.auction.seedBid(fakeBidRecord({ bidder: s.me.address }));
    await expect(s.bidder.prepareBid(s.marketId, 650n, 200)).rejects.toMatchObject({ code: "AlreadyBid" });
  });

  it("NoTrustline with recovery change_trust", async () => {
    const s = await bidderScenario({ trustline: false });
    await expect(s.bidder.prepareBid(s.marketId, 650n, 200)).rejects.toMatchObject({ code: "NoTrustline", recovery: "change_trust" });
    expect(s.log.writes()).toEqual([]);
  });

  it("InsufficientBalance when spendable < price × qty", async () => {
    const s = await bidderScenario({ deposit: 129_999n });
    await expect(s.bidder.prepareBid(s.marketId, 650n, 200)).rejects.toMatchObject({ code: "InsufficientBalance" });
    expect(s.log.writes()).toEqual([]);
  });

  it("BalanceOutOfSync when the stored opening does not open the on-chain commitment", async () => {
    const s = await bidderScenario();
    s.token.accounts.get(s.me.address)!.spendableBalance = pedersenCommit(DEPOSIT + 1n, 0n);
    await expect(s.bidder.prepareBid(s.marketId, 650n, 200)).rejects.toMatchObject({ code: "BalanceOutOfSync" });
    expect(s.log.writes()).toEqual([]);
  });

  it("registers participant only when not registered", async () => {
    const s = await bidderScenario();
    await s.bidder.prepareBid(s.marketId, 650n, 200);
    expect(s.log.writes()).toEqual(["auction.register_participant"]);

    const t = await bidderScenario();
    t.auction.addParticipant(t.me.address);
    await t.bidder.prepareBid(t.marketId, 650n, 200);
    expect(t.log.writes()).toEqual([]);
  });
});

describe("BidderApi.prepareBid: witness e provas (S-17, D-14)", () => {
  it("set_spender witness is built before bid_validity proof and shares C_a", async () => {
    const s = await bidderScenario();
    const p = await s.bidder.prepareBid(s.marketId, 650n, 200);

    expect(s.log.all().filter((n) => n.startsWith("prove:"))).toEqual(["prove:bid_validity", "prove:set_spender"]);
    const [bv, ss] = s.prover.proved;
    expect(BigInt(bv!.inputs.collateral_binding_x as string)).toBe(BigInt(ss!.inputs.c_a_x as string));
    expect(BigInt(bv!.inputs.collateral_binding_y as string)).toBe(BigInt(ss!.inputs.c_a_y as string));
    expect(p.setSpender.cA).toEqual({ x: BigInt(ss!.inputs.c_a_x as string), y: BigInt(ss!.inputs.c_a_y as string) });
    expect(BigInt(ss!.inputs.v_a as string)).toBe(650n * 200n);
  });

  it("liveUntil == close + grace + margin + buffer", async () => {
    const s = await bidderScenario();
    const p = await s.bidder.prepareBid(s.marketId, 650n, 200);
    expect(p.setSpender.liveUntilLedger).toBe(CLOSE + FINALIZATION_GRACE_LEDGERS + SETTLEMENT_MARGIN_LEDGERS + TTL_BUFFER_LEDGERS);

    expect(p.setSpender.liveUntilLedger - TTL_BUFFER_LEDGERS).toBe(CLOSE + FINALIZATION_GRACE_LEDGERS + SETTLEMENT_MARGIN_LEDGERS);
  });

  it("proof failure leaves no write call", async () => {
    const s = await bidderScenario();
    s.auction.addParticipant(s.me.address);
    s.prover.failOn("bid_validity");
    await expect(s.bidder.prepareBid(s.marketId, 650n, 200)).rejects.toMatchObject({ code: "ProofFailed" });
    expect(s.log.writes()).toEqual([]);
    expect(s.log.all()).not.toContain("prove:set_spender");
  });

  it("the submission carries the commitment, nullifier and envelope the proof was built on", async () => {
    const s = await bidderScenario();
    const p = await s.bidder.prepareBid(s.marketId, 650n, 200);
    const bv = s.prover.proved[0]!.inputs;
    expect(p.submission.requestedQuantity).toBe(200);
    expect(BigInt(bv.commitment as string)).toBe(p.submission.commitment);
    expect(BigInt(bv.nullifier as string)).toBe(p.submission.nullifier);
    expect(BigInt(bv.ciphertext_price as string)).toBe(p.submission.envelope.ctPrice);
    expect(p.submission.proof).toHaveLength(14_592);
    expect(p.participantId).toBe(0);
  });

  it("PreparedBid JSON has no secret", async () => {
    const s = await bidderScenario();
    const p = await s.bidder.prepareBid(s.marketId, 650n, 200);
    const json = JSON.stringify(p, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v));
    const ss = s.prover.proved[1]!.inputs;
    const bv = s.prover.proved[0]!.inputs;
    assertNoSecretLeak(
      [650n * 200n, BigInt(bv.blinding as string), BigInt(bv.nullifier_seed as string), BigInt(bv.r as string), BigInt(bv.collateral_randomness as string), s.myKeys.sk.expose(), BigInt(ss.v as string) - 650n * 200n],
      [json, s.logger, p],
    );
    expect(p.secrets).toBeInstanceOf(Secret);

    expect(json).not.toMatch(/"price"/);
  });

  it("prepareBid is deterministic under SeededRng", async () => {
    const a = await bidderScenario({ seed: "same" });
    const b = await bidderScenario({ seed: "same" });
    const pa = await a.bidder.prepareBid(a.marketId, 650n, 200);
    const pb = await b.bidder.prepareBid(b.marketId, 650n, 200);
    expect(pa.submission.commitment).toBe(pb.submission.commitment);
    expect(pa.submission.envelope).toEqual(pb.submission.envelope);
    expect(Buffer.from(pa.setSpender.data)).toEqual(Buffer.from(pb.setSpender.data));
    const c = await bidderScenario({ seed: "other" });
    expect((await c.bidder.prepareBid(c.marketId, 650n, 200)).submission.commitment).not.toBe(pa.submission.commitment);
  });

  it("warns DepositRevealsPrice when last deposit == price × qty", async () => {
    const s = await bidderScenario({ lastDeposit: 130_000n });
    expect((await s.bidder.prepareBid(s.marketId, 650n, 200)).warnings).toEqual(["DepositRevealsPrice"]);
    const t = await bidderScenario();
    expect((await t.bidder.prepareBid(t.marketId, 650n, 200)).warnings).toEqual([]);
  });
});
