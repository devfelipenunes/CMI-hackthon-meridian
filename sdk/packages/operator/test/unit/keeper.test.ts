import type { AuctionPort, SettleOutcome } from "@zolvency-cmi/core";
import { assertNoSecretLeak } from "@zolvency-cmi/testing";
import { describe, expect, it } from "vitest";

import { Keeper, type KeeperEvent } from "../../src/index.js";
import { AURORA_BIDS, SK_ENV, SK_OP, finalizedMarket, makeOperator, type BidSpec } from "../helpers/market.js";

async function keeperOn(bids: readonly BidSpec[] = AURORA_BIDS, retry?: { maxAttempts: number }) {
  const m = await finalizedMarket(bids);
  const events: KeeperEvent[] = [];
  const keeper = new Keeper(m.operator, { clock: m.clock, onEvent: (e) => events.push(e), ...(retry === undefined ? {} : { retry }) });
  const settles = () => m.log.names().filter((n) => n === "auction.settle").length;
  return { ...m, keeper, events, settles };
}

describe("Keeper (passo 5.5)", () => {
  it("at most one settle per ledger", async () => {
    const k = await keeperOn();
    expect(await k.keeper.tick(k.auction.address)).toEqual({ kind: "settle", bidIndex: 0 });
    const ledger = await k.clock.ledger();
    expect(await k.keeper.tick(k.auction.address)).toEqual({ kind: "wait", untilLedger: ledger + 1 });
    expect(k.settles()).toBe(1);
    k.clock.advanceBy(1);
    expect(await k.keeper.tick(k.auction.address)).toEqual({ kind: "settle", bidIndex: 1 });
    expect(k.settles()).toBe(2);
  });

  it("ResourceContention retries on next ledger", async () => {
    const k = await keeperOn();
    k.auction.failNext("settle", "ResourceContention");
    const ledger = await k.clock.ledger();
    expect(await k.keeper.tick(k.auction.address)).toEqual({ kind: "wait", untilLedger: ledger + 1 });
    expect(k.events.some((e) => e.kind === "retry" && e.code === "ResourceContention")).toBe(true);
    k.clock.advanceBy(1);
    expect(await k.keeper.tick(k.auction.address)).toEqual({ kind: "settle", bidIndex: 0 });
    expect(await k.auction.getSettlementStatus(0)).toBe("Settled");
  });

  it("AlreadySettled is treated as success (D-09)", async () => {
    const k = await keeperOn();

    const raced = new Proxy(k.auction, {
      get: (t, prop) => {
        if (prop === "settle") return async (): Promise<SettleOutcome> => "AlreadySettled";
        const v = Reflect.get(t, prop) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    }) as AuctionPort;
    const keeper = new Keeper(makeOperator({ ...k, auction: raced }), { clock: k.clock, onEvent: (e) => k.events.push(e) });
    expect(await keeper.tick(k.auction.address)).toEqual({ kind: "settle", bidIndex: 0 });
    expect(k.events).toContainEqual(expect.objectContaining({ kind: "settled", bidIndex: 0, outcome: "AlreadySettled" }));
    expect(k.events.some((e) => e.kind === "failed")).toBe(false);
  });

  it("partial run then restart continues where it stopped (RF-21)", async () => {
    const k = await keeperOn();
    await k.keeper.tick(k.auction.address);
    k.clock.advanceBy(1);
    await k.keeper.tick(k.auction.address);

    const restarted = new Keeper(k.operator, { clock: k.clock });
    k.clock.advanceBy(1);
    expect(await restarted.tick(k.auction.address)).toEqual({ kind: "settle", bidIndex: 2 });
    expect(k.settles()).toBe(3);
  });

  it("one failing bid does not block the others (S7)", async () => {
    const k = await keeperOn(AURORA_BIDS, { maxAttempts: 1 });
    await k.keeper.tick(k.auction.address);
    k.clock.advanceBy(1);
    k.auction.failNext("settle", "Auction.InvalidSettlementProof");
    expect((await k.keeper.tick(k.auction.address)).kind).toBe("settle");
    expect(k.events).toContainEqual(expect.objectContaining({ kind: "quarantined", bidIndex: 1 }));
    k.clock.advanceBy(1);
    expect(await k.keeper.tick(k.auction.address)).toEqual({ kind: "settle", bidIndex: 2 });
    expect(await k.auction.getSettlementStatus(2)).toBe("Settled");
    expect(await k.auction.getSettlementStatus(1)).toBe("Pending");
  });

  it("a bid whose delegation is gone is released, not settled", async () => {
    const k = await keeperOn(AURORA_BIDS.map((b, i) => (i === 0 ? { ...b, revoked: true } : b)));
    expect(await k.keeper.tick(k.auction.address)).toEqual({ kind: "release_unsettled", bidIndex: 0 });
    expect(await k.auction.getSettlementStatus(0)).toBe("Failed");
  });

  it("a market with 8 bids goes from Finalized to Settled, one settle per ledger", async () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ price: 650n - 10n * BigInt(i), quantity: 150 }));
    const k = await keeperOn(eight);
    const ledgers = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const a = await k.keeper.tick(k.auction.address);
      if (a.kind === "settle") ledgers.add(await k.clock.ledger());
      if (a.kind === "done") break;
      k.clock.advanceBy(1);
    }
    expect(await k.auction.getState()).toBe("Settled");
    expect(k.settles()).toBe(8);
    expect(ledgers.size).toBe(8);
  });

  it("run stops on AbortSignal", async () => {
    const k = await keeperOn();
    const ac = new AbortController();
    let yielded = 0;
    async function* forever() {
      for (;;) {
        yielded++;
        if (yielded === 3) ac.abort();
        yield k.auction.address;
      }
    }
    await k.keeper.run(forever(), ac.signal);
    expect(yielded).toBeLessThanOrEqual(4);
  });

  it("keeper events carry no secret", async () => {
    const k = await keeperOn();
    for (let i = 0; i < 6; i++) {
      await k.keeper.tick(k.auction.address);
      k.clock.advanceBy(1);
    }
    const secrets = [SK_OP, SK_ENV, ...k.secrets.flatMap((s) => [s.price, s.blinding, s.nullifierSeed])];
    assertNoSecretLeak(secrets, [k.events, k.logger]);
    expect(k.events.length).toBeGreaterThan(0);
  });
});
