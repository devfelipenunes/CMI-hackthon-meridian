import { describe, expect, it } from "vitest";

import { MarketsApi, type MarketEvent } from "../../src/index.js";
import { CLOSE, PARAMS } from "../helpers/bidder.js";
import { settledAurora } from "../helpers/settled.js";

async function scenario() {
  const s = await settledAurora();
  return { ...s, markets: new MarketsApi(s.ctx) };
}

describe("MarketsApi (passo 6.1)", () => {
  it("list and get return MarketView without any price", async () => {
    const s = await scenario();
    const view = await s.markets.get(s.marketId);
    expect(view).toEqual({
      marketId: s.marketId,
      address: s.address,
      seller: s.seller.address,
      status: "Settled",
      quotaAsset: PARAMS.quotaAsset,
      totalQuotas: 1_000,
      minPricePerQuota: 500n,
      closeLedger: CLOSE,
      finalizeByLedger: expect.any(Number) as number,
      bidCount: 4,
      demand: 1_400,
      allocation: [200, 500, 300, 0],
    });
    expect(await s.markets.list()).toEqual([view]);
    expect(await s.markets.list({ status: ["Open"] })).toEqual([]);

    expect(Object.keys(view).sort()).toEqual(["address", "allocation", "bidCount", "closeLedger", "demand", "finalizeByLedger", "marketId", "minPricePerQuota", "quotaAsset", "seller", "status", "totalQuotas"]);
  });

  it("public demand = sum of requested_quantity", async () => {
    const s = await scenario();
    expect((await s.markets.get(s.marketId)).demand).toBe(200 + 500 + 400 + 300);
  });

  it("an open market has no allocation yet", async () => {
    const s = await scenario();
    const { marketId } = await s.factory.createMarket(s.seller, { ...PARAMS, closeLedger: CLOSE + 5_000 }, new Uint8Array([1]));
    expect(await s.markets.get(marketId)).toMatchObject({ status: "Created", bidCount: 0, demand: 0, allocation: null });
  });

  it("watch yields events in ledger order (BidAccepted, MarketClosed…) and ends with the market", async () => {
    const s = await scenario();
    const got: MarketEvent[] = [];
    for await (const e of s.markets.watch(s.marketId, { fromLedger: 0, pollIntervalMs: 0 })) got.push(e);
    expect(got.map((e) => e.kind)).toEqual([
      "MarketOpened",
      ...Array<string>(4).fill("ParticipantRegistered").flatMap((p) => [p, "BidAccepted"]),
      "MarketClosed",
      "MarketFinalized",
      "BidSettled", "BidSettled", "BidSettled", "BidSettled",
      "MarketSettled",
    ]);
    const ledgers = got.map((e) => e.ledger);
    expect(ledgers).toEqual([...ledgers].sort((a, b) => a - b));
    expect(got.find((e) => e.kind === "BidAccepted")).toMatchObject({ bidIndex: 0, requestedQuantity: 200 });
    expect(got.find((e) => e.kind === "MarketFinalized")).toMatchObject({ filled: [200, 500, 300, 0], unsold: 0 });
  });

  it("watch stops on AbortSignal while the market is still running", async () => {
    const s = await scenario();
    const { marketId } = await s.factory.createMarket(s.seller, { ...PARAMS, closeLedger: CLOSE + 5_000 }, new Uint8Array([1]));
    const ac = new AbortController();
    const it = s.markets.watch(marketId, { fromLedger: 0, pollIntervalMs: 1, signal: ac.signal })[Symbol.asyncIterator]();
    setTimeout(() => ac.abort(), 20);
    expect(await it.next()).toEqual({ done: true, value: undefined });
  });
});
