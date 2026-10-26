import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { FINALIZATION_GRACE_LEDGERS, commitmentsRoot, keypairSigner, type MarketParams, type MarketStatus } from "@zolvency-cmi/core";
import { describe, expect, it } from "vitest";

import { CallLog, FAKE_PLATFORM, FakeAuction, FakeClock, FakeFactory, FakeToken, MARKET_TRANSITIONS, fakeBidRecord } from "../../src/index.js";

const CONTRACTS = fileURLToPath(new URL("../../../../contracts/", import.meta.url));
const SELLER = keypairSigner(Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).secret());
const QUOTA = StrKey.encodeContract(Buffer.alloc(32, 9));
const CLOSE = 1_000;
const STATES: MarketStatus[] = ["Created", "Open", "Closed", "Finalized", "Settled", "Cancelled"];

function contractTransitions(): [string, string][] {
  const src = readFileSync(`${CONTRACTS}contracts/auction/src/market.rs`, "utf8");
  const body = src.slice(src.indexOf("fn is_legal"), src.indexOf("}", src.indexOf("fn is_legal")));
  return [...body.matchAll(/\(MarketStatus::(\w+), MarketStatus::(\w+)\)/g)].map((m) => [m[1]!, m[2]!]);
}

const params: MarketParams = { quotaAsset: QUOTA, totalQuotas: 1000, minPricePerQuota: 500n, closeLedger: CLOSE, eligibilityPolicy: null, feeReserve: 50_000_000n };

function market(state: MarketStatus) {
  const clock = new FakeClock(10);
  const log = new CallLog();
  const auction = new FakeAuction({ log, clock, params, seller: SELLER.address, state, bids: [fakeBidRecord({ bidder: SELLER.address })] });
  return { auction, clock, log };
}

const ACTIONS: { name: string; to: MarketStatus; ledger: number; run: (a: FakeAuction) => Promise<unknown> }[] = [
  { name: "openMarket", to: "Open", ledger: 10, run: (a) => a.openMarket(SELLER) },
  { name: "cancelMarket", to: "Cancelled", ledger: 10, run: (a) => a.cancelMarket(SELLER) },
  { name: "closeMarket", to: "Closed", ledger: CLOSE, run: (a) => a.closeMarket(SELLER) },
  { name: "finalize", to: "Finalized", ledger: CLOSE + 1, run: (a) => a.finalize(SELLER, [200], new Uint8Array()) },
  { name: "cancelExpired", to: "Cancelled", ledger: CLOSE + FINALIZATION_GRACE_LEDGERS + 1, run: (a) => a.cancelExpired(SELLER) },
  {
    name: "settle", to: "Settled", ledger: CLOSE + 1,
    run: (a) => a.settle(SELLER, 0, { sellerData: new Uint8Array(), feeData: new Uint8Array(), refundData: new Uint8Array() }, new Uint8Array()),
  },
];

describe("FakeAuction (S-08: o fake não pode mentir)", () => {
  it("MARKET_TRANSITIONS is the is_legal table of the contract", () => {
    expect([...MARKET_TRANSITIONS].map(([a, b]) => `${a}->${b}`).sort()).toEqual(contractTransitions().map(([a, b]) => `${a}->${b}`).sort());
  });

  const cases = STATES.flatMap((from) => ACTIONS.map((a) => [from, a] as const));
  it.each(cases)("FakeAuction follows RF-03 transition table: %s + %o", async (from, action) => {
    const { auction, clock } = market(from);
    clock.advanceTo(action.ledger);

    const legal = MARKET_TRANSITIONS.some(([a, b]) => a === from && b === action.to) && !(action.name === "cancelMarket" && from === "Open");

    if (action.name === "settle" && from === "Cancelled") {
      await action.run(auction);
      expect(await auction.getState()).toBe("Cancelled");
    } else if (legal) {
      await action.run(auction);
      expect(await auction.getState()).toBe(action.to);
    } else {
      await expect(action.run(auction)).rejects.toMatchObject({ code: expect.stringMatching(/^Auction\.(InvalidState|HasBids)$/) });
      expect(await auction.getState()).toBe(from);
    }
  });

  it("cancelMarket in Open with bids maps HasBids", async () => {
    await expect(market("Open").auction.cancelMarket(SELLER)).rejects.toMatchObject({ code: "Auction.HasBids" });
  });

  it("closeMarket before close_ledger is TooEarly; Open without bids closes to Cancelled", async () => {
    const { auction } = market("Open");
    await expect(auction.closeMarket(SELLER)).rejects.toMatchObject({ code: "Auction.TooEarly" });
    const empty = new FakeAuction({ log: new CallLog(), clock: new FakeClock(CLOSE), params, seller: SELLER.address, state: "Open" });
    await empty.closeMarket(SELLER);
    expect(await empty.getState()).toBe("Cancelled");
  });

  it("closeMarket freezes the commitments root of the accepted bids (RF-16)", async () => {
    const auction = new FakeAuction({ log: new CallLog(), clock: new FakeClock(CLOSE), params, seller: SELLER.address, state: "Open" });
    auction.seedBid(fakeBidRecord({ bidder: SELLER.address, commitment: 111n }));
    expect(await auction.getCommitmentsRoot()).toBeNull();
    await auction.closeMarket(SELLER);
    expect(await auction.getCommitmentsRoot()).toBe(commitmentsRoot([111n]));
  });

  it("settle in a Cancelled market refunds (filled 0) and the market stays Cancelled (settlement.rs)", async () => {
    const { auction, clock } = market("Closed");
    clock.advanceTo(CLOSE + FINALIZATION_GRACE_LEDGERS + 1);
    await auction.cancelExpired(SELLER);
    const legs = { sellerData: new Uint8Array(), feeData: new Uint8Array(), refundData: new Uint8Array() };
    expect(await auction.settle(SELLER, 0, legs, new Uint8Array())).toBe("Settled");
    expect(await auction.settle(SELLER, 0, legs, new Uint8Array())).toBe("AlreadySettled");
    expect(await auction.getState()).toBe("Cancelled");
  });

  it("release_unsettled needs a Finalized/Cancelled market and a dead delegation, and closes the market (settlement.rs)", async () => {
    const clock = new FakeClock(CLOSE + 1);
    const log = new CallLog();
    const token = new FakeToken({ log, clock });
    const bidder = SELLER.address;
    const auction = new FakeAuction({ log, clock, params, seller: SELLER.address, state: "Finalized", token, bids: [fakeBidRecord({ bidder })] });
    token.delegations.set(`${bidder}|${auction.address}`, { allowanceCommitment: { x: 1n, y: 2n }, encryptedAllowance: 3n, escrowedDvk: { rX: 4n, cipher: 5n }, allowanceSalt: 6n, liveUntilLedger: CLOSE + 10 });
    await expect(auction.releaseUnsettled(SELLER, 0)).rejects.toMatchObject({ code: "Auction.DelegationStillActive" });
    clock.advanceTo(CLOSE + 11);
    await auction.releaseUnsettled(SELLER, 0);
    expect(await auction.getSettlementStatus(0)).toBe("Failed");
    expect(await auction.getState()).toBe("Settled");
    await expect(auction.releaseUnsettled(SELLER, 0)).rejects.toMatchObject({ code: "Auction.BidAlreadyClosed" });
    await expect(market("Closed").auction.releaseUnsettled(SELLER, 0)).rejects.toMatchObject({ code: "Auction.InvalidState" });
  });

  it("finalize_by_ledger comes from the platform grace frozen in the market (ADR-027)", async () => {
    const auction = new FakeAuction({ log: new CallLog(), clock: new FakeClock(CLOSE), params, seller: SELLER.address, state: "Open", platform: { ...FAKE_PLATFORM, finalizationGraceLedgers: 30 } });
    auction.seedBid(fakeBidRecord({ bidder: SELLER.address }));
    await auction.closeMarket(SELLER);
    expect((await auction.getMarket()).finalizationGraceLedgers).toBe(30);
    expect(await auction.getFinalizeByLedger()).toBe(CLOSE + 30);
  });

  it("records reads and writes in order, and failNext injects a contract error once", async () => {
    const { auction, log } = market("Created");
    auction.failNext("open_market", "Auction.InvalidState");
    await expect(auction.openMarket(SELLER)).rejects.toMatchObject({ code: "Auction.InvalidState" });
    await auction.openMarket(SELLER);
    await auction.getState();
    expect(log.names()).toEqual(["auction.open_market", "auction.open_market", "auction.get_state"]);
    expect(log.writes()).toEqual(["auction.open_market", "auction.open_market"]);
  });
});

describe("FakeFactory", () => {
  it("validates params like the contract and creates a FakeAuction at the predicted address", async () => {
    const log = new CallLog();
    const factory = new FakeFactory({ log, clock: new FakeClock(10) });
    await expect(factory.createMarket(SELLER, { ...params, totalQuotas: 0 }, new Uint8Array())).rejects.toMatchObject({ code: "Factory.InvalidTotalQuotas" });
    const id = await factory.nextMarketId();
    const predicted = await factory.predictMarketAddress(id);
    const created = await factory.createMarket(SELLER, params, new Uint8Array([1]));
    expect(created).toEqual({ marketId: id, address: predicted });
    expect(await factory.getMarketAddress(id)).toBe(predicted);
    expect(await factory.auction(predicted).getState()).toBe("Created");
  });

  it("failCreate fails the next creations without consuming the market_id (a failed tx reverts)", async () => {
    const factory = new FakeFactory({ log: new CallLog(), clock: new FakeClock(10) });
    factory.failCreate(1, "ResourceContention");
    await expect(factory.createMarket(SELLER, params, new Uint8Array())).rejects.toMatchObject({ code: "ResourceContention" });
    await expect(factory.createMarket(SELLER, params, new Uint8Array())).resolves.toMatchObject({ marketId: 1n });
  });
});
