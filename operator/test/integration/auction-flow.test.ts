import { AURORA } from "@zolvency-cmi/testing";
import { describe, expect, it } from "vitest";

import { AURORA_BIDS, World } from "../helpers/world.js";
import { runUntil, seededDb, testService } from "../helpers/service.js";

describe("fluxo do leilão pelo serviço", () => {
  it("discovers a market without notice and takes Aurora from Open to Settled", async () => {
    const s = await testService();
    const { id, address, auction } = await s.world.market(AURORA_BIDS, { closeIn: 30 });

    const first = await s.loop.runOnce();
    expect(first.discovered).toEqual([id]);
    expect(s.repos.markets.get(id)).toMatchObject({ status: "Open", address, bidCount: 4 });

    await runUntil(s, async () => (await auction.getState()) === "Settled");
    expect(await auction.getAllocation()).toEqual([...AURORA.expected.filled]);

    await s.step();
    await s.step();
    const m = s.repos.markets.get(id)!;
    expect(m).toMatchObject({ status: "Settled", nextCheckLedger: null, unsold: 0 });
    expect(s.repos.bids.forMarket(id).map((b) => [b.filledQuantity, b.status])).toEqual([
      [200, "Settled"],
      [500, "Settled"],
      [300, "Settled"],
      [0, "Settled"],
    ]);
    const kinds = s.repos.actions.forMarket(id, { limit: 50 }).reverse().map((a) => `${a.kind}${a.bidIndex === null ? "" : `:${a.bidIndex}`}:${a.outcome}`);
    expect(kinds).toEqual(["close:ok", "finalize:ok", "settle:0:ok", "settle:1:ok", "settle:2:ok", "settle:3:ok"]);
    await s.close();
  });

  it("closes at close_ledger, not before", async () => {
    const s = await testService();
    const { auction } = await s.world.market(AURORA_BIDS, { closeIn: 20 });
    const close = (await auction.getMarket()).params.closeLedger;
    await s.loop.runOnce();
    while ((await s.world.clock.ledger()) < close - 1) {
      await s.step();
      expect(await auction.getState()).toBe("Open");
    }
    await s.step();
    expect(await auction.getState()).toBe("Closed");
    await s.close();
  });

  it("an Open market far from close is only read at reconciliation", async () => {
    const s = await testService({ tuning: { reconcileLedgers: 10 } });
    const { id } = await s.world.market(AURORA_BIDS, { closeIn: 1_000 });
    await s.loop.runOnce();
    expect(s.repos.markets.get(id)?.nextCheckLedger).toBe((await s.world.clock.ledger()) + 10);
    const ticks: number[] = [];
    for (let i = 0; i < 25; i++) if ((await s.step()).ticks.length > 0) ticks.push(i);
    expect(ticks).toEqual([9, 19]);
    await s.close();
  });

  it("a market with no bids is cancelled at close and leaves the schedule", async () => {
    const s = await testService();
    const { id, auction } = await s.world.market([], { closeIn: 5 });
    await runUntil(s, async () => (await auction.getState()) === "Cancelled");
    await s.step();
    expect(s.repos.markets.get(id)).toMatchObject({ status: "Cancelled", nextCheckLedger: null });
    await s.close();
  });

  it("never two settles in the same ledger, across two markets", async () => {
    const s = await testService();
    const a = await s.world.market(AURORA_BIDS, { closeIn: 10 });
    const b = await s.world.market(AURORA_BIDS, { closeIn: 10 });
    const settlesByLedger = new Map<number, number>();
    await runUntil(s, async () => {
      const r = s.loop.lastReport;
      if (r?.ledger != null) settlesByLedger.set(r.ledger, r.ticks.filter((t) => t.action === "settle" && t.outcome === "ok").length);
      return (await a.auction.getState()) === "Settled" && (await b.auction.getState()) === "Settled";
    });
    expect(Math.max(...settlesByLedger.values())).toBe(1);
    expect([...settlesByLedger.values()].reduce((x, y) => x + y, 0)).toBe(8);
    await s.close();
  });

  it("a revoked delegation is closed with release_unsettled", async () => {
    const s = await testService();
    const bids = AURORA_BIDS.map((b, i) => (i === 1 ? { ...b, revoked: true } : b));
    const { id, auction } = await s.world.market(bids, { closeIn: 5 });
    await runUntil(s, async () => (await auction.getState()) === "Settled");
    expect(await auction.getSettlementStatus(1)).toBe("Failed");
    expect(s.repos.actions.forMarket(id, { limit: 20 }).some((a) => a.kind === "release_unsettled" && a.bidIndex === 1 && a.outcome === "ok")).toBe(true);
    await s.close();
  });

  it("AlreadySettled (someone else settled first) is recorded as already_settled", async () => {
    const s = await testService();
    const { id, auction } = await s.world.market(AURORA_BIDS, { closeIn: 5 });
    await runUntil(s, async () => (await auction.getState()) === "Finalized");

    const settle = auction.settle.bind(auction);
    let raced = false;
    auction.settle = async (...args: Parameters<typeof settle>) => {
      if (!raced) {
        raced = true;
        await settle(...args);
      }
      return settle(...args);
    };
    await runUntil(s, async () => (await auction.getState()) === "Settled");
    expect(s.repos.actions.forMarket(id, { limit: 20 }).find((a) => a.kind === "settle" && a.bidIndex === 0)?.outcome).toBe("already_settled");
    await s.close();
  });

  it("someone else closed first: the next tick just moves on", async () => {
    const s = await testService();
    const { auction } = await s.world.market(AURORA_BIDS, { closeIn: 5 });
    await s.loop.runOnce();
    s.world.clock.advanceBy(5);
    await auction.closeMarket({ address: "GSOMEONE" } as never);
    await runUntil(s, async () => (await auction.getState()) === "Settled");
    await s.close();
  });
});

describe("falhas e caminhos ruins", () => {
  it("IntegrityMismatch raises a critical alert and backs off without proving every ledger", async () => {
    const s = await testService();
    const bids = AURORA_BIDS.map((b, i) => (i === 2 ? { ...b, tamper: true } : b));
    const { id, auction } = await s.world.market(bids, { closeIn: 5 });
    await runUntil(s, async () => (await auction.getState()) === "Closed");
    const ticks: number[] = [];
    for (let i = 0; i < 40; i++) if ((await s.step()).ticks.some((t) => t.marketId === id)) ticks.push(i);
    expect(await auction.getState()).toBe("Closed");

    expect(ticks.length).toBeLessThanOrEqual(6);
    const alerts = s.repos.alerts.list({ open: true, limit: 20 });
    expect(alerts.some((a) => a.kind === "IntegrityMismatch" && a.severity === "critical" && a.marketId === id)).toBe(true);
    expect(s.repos.markets.get(id)!.backoffAttempts).toBeGreaterThan(1);
    await s.close();
  });

  it("timeout: Closed past finalize_by_ledger → cancel_expired, refunds, TimedOut alert", async () => {
    const s = await testService({ tuning: { deadlineWarnLedgers: 70_000 } });
    const { id, auction } = await s.world.market(AURORA_BIDS, { closeIn: 5 });
    await runUntil(s, async () => (await auction.getState()) === "Closed");
    s.loop.pause();
    const finalizeBy = (await auction.getFinalizeByLedger())!;
    s.world.clock.advanceTo(finalizeBy + 1);
    await s.loop.runOnce();
    expect(await auction.getState()).toBe("Closed");
    s.loop.resume();
    await runUntil(s, async () => (await auction.getSettlementStatus(3)) !== "Pending");
    expect(await auction.getState()).toBe("Cancelled");
    for (let i = 0; i < 4; i++) expect(await auction.getSettlementStatus(i)).toBe("Settled");
    const kinds = s.repos.alerts.list({ limit: 50 }).map((a) => `${a.kind}:${a.severity}`);
    expect(kinds).toContain("TimedOut:critical");
    expect(kinds).toContain("DeadlineNear:critical");
    await s.step();
    await s.step();
    expect(s.repos.markets.get(id)).toMatchObject({ status: "Cancelled", nextCheckLedger: null });
    await s.close();
  });

  it("restart after 2 of 4 settles finishes with 2 more, none repeated", async () => {
    const world = new World();
    const db = seededDb();
    const s1 = await testService({ world, db });
    const { id, auction } = await world.market(AURORA_BIDS, { closeIn: 5 });
    await runUntil(s1, async () => (await auction.getSettlementStatus(1)) === "Settled");
    expect(await auction.getSettlementStatus(2)).toBe("Pending");
    s1.loop.release();

    const s2 = await testService({ world, db });
    await runUntil(s2, async () => (await auction.getState()) === "Settled");
    const settles = world.log.names().filter((n) => n === "auction.settle").length;
    expect(settles).toBe(4);
    expect(s2.repos.actions.forMarket(id, { limit: 50 }).filter((a) => a.kind === "settle" && a.outcome === "ok")).toHaveLength(4);
    await s2.close();
  });

  it("a quarantined bid raises BidQuarantined and the others continue (OP-19)", async () => {
    const s = await testService({ retry: { maxAttempts: 1 } });
    const { id, auction } = await s.world.market(AURORA_BIDS, { closeIn: 5 });
    await runUntil(s, async () => (await auction.getState()) === "Finalized");
    auction.failNext("settle", "Auction.InvalidSettlementProof");
    await runUntil(s, async () => (await auction.getSettlementStatus(3)) === "Settled");
    expect(await auction.getSettlementStatus(0)).toBe("Pending");
    const alert = s.repos.alerts.list({ open: true, limit: 20 }).find((a) => a.kind === "BidQuarantined");
    expect(alert).toMatchObject({ marketId: id, bidIndex: 0, severity: "critical" });
    expect(alert!.message).toMatch(/restart/);
    expect(s.repos.bids.forMarket(id)[0]!.quarantined).toBe(true);
    await s.close();
  });

  it("an RPC failure stops nothing: after 3 failures a RpcUnavailable alert, then it recovers", async () => {
    const s = await testService();
    const { auction } = await s.world.market(AURORA_BIDS, { closeIn: 5 });
    await s.loop.runOnce();
    s.world.rpcDown();
    for (let i = 0; i < 3; i++) expect((await s.step()).ledger).toBeNull();
    expect(s.repos.alerts.list({ limit: 10 }).some((a) => a.kind === "RpcUnavailable")).toBe(true);
    s.world.rpcUp();
    await runUntil(s, async () => (await auction.getState()) === "Settled");
    await s.close();
  });

  it("without the lease the loop sends nothing; the second instance does not get it", async () => {
    const world = new World();
    const db = seededDb();
    const s1 = await testService({ world, db });
    const s2 = await testService({ world, db });
    const { auction } = await world.market(AURORA_BIDS, { closeIn: 2 });
    expect((await s1.loop.runOnce()).leader).toBe(true);
    world.clock.advanceBy(3);
    const r2 = await s2.loop.runOnce();
    expect(r2.leader).toBe(false);
    expect(r2.ticks).toEqual([]);
    expect(await auction.getState()).toBe("Open");
    await s1.close();
  });

  it("unsupported contracts version: stored, alerted, not operated", async () => {
    const world = new World();
    const ports = world.ports();
    world.ports = () => ({ ...ports, versionOf: async () => Promise.reject(Object.assign(new Error("x"), { code: "UnsupportedContractsVersion" })) });
    const s = await testService({ world });
    const { id, auction } = await world.market(AURORA_BIDS, { closeIn: 2 });
    await s.loop.runOnce();
    await s.step(5);
    expect(s.repos.markets.get(id)).toMatchObject({ supported: false, nextCheckLedger: null });
    expect(await auction.getState()).toBe("Open");
    expect(s.repos.alerts.list({ limit: 5 })[0]).toMatchObject({ kind: "UnsupportedMarket", marketId: id });
    await s.close();
  });

  it("discovery advances the cursor only after storing, and resumes from it", async () => {
    const s = await testService();
    await s.world.market(AURORA_BIDS);
    await s.world.market(AURORA_BIDS);
    const getMarket = s.world.factory.getMarketAddress.bind(s.world.factory);
    let calls = 0;
    s.world.factory.getMarketAddress = async (id: bigint) => {
      if (id === 2n && calls++ === 0) throw new Error("rpc hiccup");
      return getMarket(id);
    };
    await s.loop.runOnce();
    expect(s.repos.markets.get(1n)).not.toBeNull();
    expect(s.repos.markets.get(2n)).toBeNull();
    expect(s.repos.meta.get("factory_cursor")).toBe("1");
    s.loop.requestDiscovery();
    expect((await s.step()).discovered).toEqual([2n]);
    await s.close();
  });
});
