import type { MarketView } from "@zolvency-cmi/client";
import type { AuctionEvent, MarketStatus } from "@zolvency-cmi/core";
import { describe, expect, it } from "vitest";

import { actionsFor, operatorProgress, statusLabel, statusTone } from "@/domain/market";

const ME = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const OTHER = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function market(over: Partial<MarketView> = {}): MarketView {
  return {
    marketId: 7n,
    address: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    seller: OTHER,
    status: "Open",
    quotaAsset: "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    totalQuotas: 100,
    minPricePerQuota: 10_000_000n,
    closeLedger: 1_000,
    finalizeByLedger: null,
    bidCount: 2,
    demand: 12,
    allocation: null,
    ...over,
  };
}

describe("market status", () => {
  it("labels every on-chain status in English with a non-colour tone", () => {
    const statuses: MarketStatus[] = ["Created", "Open", "Closed", "Finalized", "Settled", "Cancelled"];
    for (const s of statuses) {
      expect(statusLabel(s)).not.toBe("");
      expect(["neutral", "live", "progress", "success", "danger"]).toContain(statusTone(s));
    }

    expect(statusLabel("Created")).toBe("Not open");
  });
});

describe("actionsFor", () => {
  it("offers a bid only to an investor while bidding is open", () => {
    const actions = actionsFor({ market: market(), mode: "investor", me: ME, ledger: 900 });
    expect(actions.map((a) => a.kind)).toEqual(["bid"]);
  });

  it("hides the bid from the company mode and after the close ledger", () => {
    expect(actionsFor({ market: market(), mode: "company", me: ME, ledger: 900 }).some((a) => a.kind === "bid")).toBe(false);
    expect(actionsFor({ market: market(), mode: "investor", me: ME, ledger: 1_000 }).some((a) => a.kind === "bid")).toBe(false);
  });

  it("lets any wallet close an open market after its close ledger", () => {
    const actions = actionsFor({ market: market(), mode: null, me: ME, ledger: 1_001 });
    expect(actions.find((a) => a.kind === "close")).toMatchObject({ kind: "close", label: "Close auction" });
  });

  it("offers the timeout cancellation only after the finalization deadline", () => {
    const closed = market({ status: "Closed", finalizeByLedger: 1_120, bidCount: 3 });
    expect(actionsFor({ market: closed, mode: null, me: ME, ledger: 1_120 }).some((a) => a.kind === "cancel-expired")).toBe(false);
    expect(actionsFor({ market: closed, mode: null, me: ME, ledger: 1_121 }).some((a) => a.kind === "cancel-expired")).toBe(true);
  });

  it("gives the seller open/cancel on Created and cancel only before bids when Open", () => {
    const created = market({ status: "Created", seller: ME, bidCount: 0 });
    expect(actionsFor({ market: created, mode: "company", me: ME, ledger: 900 }).map((a) => a.kind)).toEqual(["open", "cancel"]);
    const openNoBids = market({ status: "Open", seller: ME, bidCount: 0 });
    expect(actionsFor({ market: openNoBids, mode: "company", me: ME, ledger: 900 }).map((a) => a.kind)).toEqual(["cancel"]);
    const openWithBids = market({ status: "Open", seller: ME, bidCount: 1 });
    expect(actionsFor({ market: openWithBids, mode: "company", me: ME, ledger: 900 })).toEqual([]);
  });

  it("is empty for someone who is not the seller on Created", () => {
    expect(actionsFor({ market: market({ status: "Created" }), mode: "company", me: ME, ledger: 900 })).toEqual([]);
  });

  it("reveals no action based on price data", () => {
    const actions = actionsFor({ market: market({ status: "Settled", allocation: [10, 2] }), mode: "investor", me: ME, ledger: 1_500 });
    expect(JSON.stringify(actions)).not.toMatch(/price|preço/i);
  });
});

describe("operatorProgress", () => {
  const closed: AuctionEvent = {
    kind: "MarketClosed",
    ledger: 1_000,
    marketId: 7n,
    bidCount: 4,
    commitmentsRoot: 0n,
    finalizeByLedger: 1_120,
  };

  it("waits for the close while the market is open", () => {
    const p = operatorProgress({ market: market(), ledger: 900, events: [] });
    expect(p.title).toBe("Bidding open");
    expect(p.tone).toBe("live");
  });

  it("tells the user anyone can close once the close ledger passes", () => {
    const p = operatorProgress({ market: market(), ledger: 1_000, events: [] });
    expect(p.title).toMatch(/close/i);
    expect(p.detail).toMatch(/any wallet/i);
  });

  it("shows the operator deadline while inside the grace period", () => {
    const m = market({ status: "Closed", finalizeByLedger: 1_120, bidCount: 4 });
    const p = operatorProgress({ market: m, ledger: 1_050, events: [closed] });
    expect(p.title).toMatch(/finalization/i);
    expect(p.detail).toMatch(/1,120/);
    expect(p.tone).toBe("progress");
  });

  it("says the operator is late and points to the permissionless cancel", () => {
    const m = market({ status: "Closed", finalizeByLedger: 1_120, bidCount: 4 });
    const p = operatorProgress({ market: m, ledger: 1_121, events: [closed] });
    expect(p.title).toMatch(/late/i);
    expect(p.tone).toBe("danger");
  });

  it("counts settlement events out of the bids, never out of a price", () => {
    const m = market({ status: "Finalized", allocation: [3, 2, 0, 0], bidCount: 4 });
    const events: AuctionEvent[] = [
      closed,
      { kind: "MarketFinalized", ledger: 1_100, marketId: 7n, filled: [3, 2, 0, 0], unsold: 95 },
      { kind: "BidSettled", ledger: 1_101, bidder: ME, bidIndex: 0, filledQuantity: 3 },
      { kind: "BidFailed", ledger: 1_102, bidder: OTHER, bidIndex: 2, filledQuantity: 0 },
    ];
    const p = operatorProgress({ market: m, ledger: 1_103, events });
    expect(p.title).toMatch(/Settling 2 of 4/);
  });

  it("closes with the final allocation after settlement", () => {
    const m = market({ status: "Settled", allocation: [40, 25, 20, 10], bidCount: 4, demand: 95 });
    const p = operatorProgress({ market: m, ledger: 1_500, events: [] });
    expect(p.title).toBe("Completed");
    expect(p.detail).toMatch(/95 of 100 quotas/);
  });

  it("shows a cancellation as final", () => {
    const m = market({ status: "Cancelled", bidCount: 2 });
    const p = operatorProgress({ market: m, ledger: 1_500, events: [] });
    expect(p.title).toMatch(/cancelled/i);
    expect(p.tone).toBe("danger");
  });
});
