import type { MarketView } from "@zolvency-cmi/client";
import { describe, expect, it } from "vitest";

import { listMarkets } from "@/sdk/useMarkets";

function view(id: bigint, status: MarketView["status"]): MarketView {
  return {
    marketId: id,
    address: `C${id.toString().padStart(55, "A")}`,
    seller: `G${id.toString().padStart(55, "B")}`,
    status,
    quotaAsset: `C${id.toString().padStart(55, "D")}`,
    totalQuotas: 100,
    minPricePerQuota: 1_000_000n,
    closeLedger: 1,
    finalizeByLedger: null,
    bidCount: 0,
    demand: 0,
    allocation: null,
  };
}

describe("listMarkets", () => {
  it("reads every id before the next one, keeping order", async () => {
    const asked: bigint[] = [];
    const source = {
      get: async (id: bigint) => {
        asked.push(id);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return view(id, "Open");
      },
    };

    const list = await listMarkets(source, 6n);

    expect(list.map((market) => market.marketId)).toEqual([1n, 2n, 3n, 4n, 5n]);
    expect(asked.sort()).toEqual([1n, 2n, 3n, 4n, 5n]);
  });

  it("does not wait for one market before asking the next", async () => {
    let inFlight = 0;
    let peak = 0;
    const source = {
      get: async (id: bigint) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight -= 1;
        return view(id, "Open");
      },
    };

    await listMarkets(source, 40n);

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(12);
  });

  it("filters by status after reading, like the SDK list", async () => {
    const source = {
      get: async (id: bigint) => view(id, id === 2n ? "Settled" : "Open"),
    };

    const list = await listMarkets(source, 4n, ["Open"]);

    expect(list.map((market) => market.marketId)).toEqual([1n, 3n]);
  });

  it("returns nothing when the factory has no market yet", async () => {
    const source = { get: async (id: bigint) => view(id, "Open") };

    await expect(listMarkets(source, 1n)).resolves.toEqual([]);
  });

  it("fails the whole read when a market fails, instead of showing a partial house", async () => {
    const source = {
      get: async (id: bigint) => {
        if (id === 3n) throw new Error("rpc indisponível");
        return view(id, "Open");
      },
    };

    await expect(listMarkets(source, 5n)).rejects.toThrow("rpc indisponível");
  });
});
