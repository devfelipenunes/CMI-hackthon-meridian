import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { MAX_DURATION_LEDGERS, keypairSigner, type MarketParams } from "@zolvency-cmi/core";
import { CallLog, FakeAuction, FakeClock, FakeFactory } from "@zolvency-cmi/testing";
import { describe, expect, it } from "vitest";

import { SellerApi, type RegisterDataProvider } from "../../src/index.js";

const SELLER = keypairSigner(Keypair.fromRawEd25519Seed(Buffer.alloc(32, 6)).secret());
const OTHER = keypairSigner(Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).secret());
const QUOTA = StrKey.encodeContract(Buffer.alloc(32, 9));
const NOW = 1_000;
const params: MarketParams = { quotaAsset: QUOTA, totalQuotas: 1000, minPricePerQuota: 500n, closeLedger: NOW + 1_000, eligibilityPolicy: null, feeReserve: 50_000_000n };

function setup() {
  const log = new CallLog();
  const clock = new FakeClock(NOW);
  const factory = new FakeFactory({ log, clock });
  const calls: string[] = [];
  const provider: RegisterDataProvider = {
    async forNextMarket() {
      calls.push("provider");
      const marketId = await factory.nextMarketId();
      return { marketId, address: await factory.predictMarketAddress(marketId), registerData: new Uint8Array([1]) };
    },
  };
  const seller = new SellerApi({ signer: SELLER, factory, auction: (a) => factory.auction(a), clock });
  return { log, clock, factory, provider, calls, seller };
}

describe("SellerApi.createMarket: preflight local (RF-01, mesmos códigos da Factory)", () => {
  it.each([
    ["rejects totalQuotas 0", { totalQuotas: 0 }, "Factory.InvalidTotalQuotas"],
    ["rejects minPrice 0", { minPricePerQuota: 0n }, "Factory.InvalidMinPrice"],
    ["rejects minPrice ≥ 2^63", { minPricePerQuota: 1n << 63n }, "Factory.InvalidMinPrice"],
    ["rejects closeLedger in the past", { closeLedger: NOW }, "Factory.InvalidCloseLedger"],
    ["rejects duration > 30 days", { closeLedger: NOW + MAX_DURATION_LEDGERS + 1 }, "Factory.DurationTooLong"],
    ["rejects feeReserve < 5 XLM", { feeReserve: 49_999_999n }, "Factory.InvalidFeeReserve"],
  ])("%s", async (_name, change, code) => {
    const { seller, provider, calls, log } = setup();
    await expect(seller.createMarket({ ...params, ...change }, provider)).rejects.toMatchObject({ code });
    expect(calls).toEqual([]);
    expect(log.writes()).toEqual([]);
  });

  it("accepts the exact limits (30 days, 5 XLM)", async () => {
    const { seller, provider } = setup();
    await expect(seller.createMarket({ ...params, closeLedger: NOW + MAX_DURATION_LEDGERS, feeReserve: 50_000_000n }, provider)).resolves.toMatchObject({ marketId: 1n });
  });
});

describe("SellerApi.createMarket: criação (D-02)", () => {
  it("creates the market with the provider register_data and returns what the Factory allocated", async () => {
    const { seller, provider, factory, log } = setup();
    const r = await seller.createMarket(params, provider);
    expect(r).toEqual({ marketId: 1n, address: await factory.getMarketAddress(1n) });
    expect(log.writes()).toEqual(["factory.create_market"]);
  });

  it("createMarket uses the market_id the Factory returns when another seller took the predicted one", async () => {
    const { seller, factory } = setup();
    const provider: RegisterDataProvider = {
      async forNextMarket() {
        const predicted = { marketId: await factory.nextMarketId(), address: await factory.predictMarketAddress(await factory.nextMarketId()) };
        await factory.createMarket(OTHER, params, new Uint8Array([2]));
        return { ...predicted, registerData: new Uint8Array([1]) };
      },
    };
    const r = await seller.createMarket(params, provider);
    expect(r.marketId).toBe(2n);
    expect(r.address).toBe(await factory.getMarketAddress(2n));
  });

  it("createMarket retries on ResourceContention", async () => {
    const { seller, provider, factory, calls } = setup();
    factory.failCreate(1, "ResourceContention");
    await expect(seller.createMarket(params, provider)).resolves.toMatchObject({ marketId: 1n });
    expect(calls).toEqual(["provider", "provider"]);
  });

  it("createMarket gives up after N retries with a typed error", async () => {
    const { seller, provider, factory, calls } = setup();
    factory.failCreate(10, "ResourceContention");
    await expect(seller.createMarket(params, provider, { maxAttempts: 3 })).rejects.toMatchObject({ code: "ResourceContention", recovery: "retry_next_ledger" });
    expect(calls).toHaveLength(3);
  });

  it("a non-retryable contract error is not retried", async () => {
    const { seller, provider, factory, calls } = setup();
    factory.failCreate(1, "Token.AccountAlreadyRegistered");
    await expect(seller.createMarket(params, provider)).rejects.toMatchObject({ code: "Token.AccountAlreadyRegistered" });
    expect(calls).toHaveLength(1);
  });
});

describe("SellerApi.openMarket / cancelMarket (RF-03, RF-07)", () => {
  it("openMarket opens a Created market", async () => {
    const { seller, provider, factory } = setup();
    const { marketId, address } = await seller.createMarket(params, provider);
    await seller.openMarket(marketId);
    expect(await factory.auction(address).getState()).toBe("Open");
  });

  it("openMarket requires Created state (checked before any transaction)", async () => {
    const { seller, provider, log } = setup();
    const { marketId } = await seller.createMarket(params, provider);
    await seller.openMarket(marketId);
    log.clear();
    await expect(seller.openMarket(marketId)).rejects.toMatchObject({ code: "Auction.InvalidState" });
    expect(log.writes()).toEqual([]);
  });

  it("cancelMarket maps HasBids on cancel", async () => {
    const { seller, provider, factory } = setup();
    const { marketId, address } = await seller.createMarket(params, provider);
    await seller.openMarket(marketId);
    const auction: FakeAuction = factory.auction(address);
    auction.addParticipant(OTHER.address);
    await auction.submitBid(OTHER, { requestedQuantity: 1, commitment: 1n, nullifier: 2n, envelope: { rPoint: { x: 1n, y: 2n }, ctPrice: 1n, ctBlinding: 1n, ctSeed: 1n }, proof: new Uint8Array() });
    await expect(seller.cancelMarket(marketId)).rejects.toMatchObject({ code: "Auction.HasBids" });
  });

  it("cancelMarket cancels an Open market without bids", async () => {
    const { seller, provider, factory } = setup();
    const { marketId, address } = await seller.createMarket(params, provider);
    await seller.openMarket(marketId);
    await seller.cancelMarket(marketId);
    expect(await factory.auction(address).getState()).toBe("Cancelled");
  });
});
