import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { migrate, openDb } from "../../src/db/open.js";
import { repos } from "../../src/db/repos.js";
import { InstanceLease } from "../../src/runner/lease.js";

const market = (id: bigint, over: Record<string, unknown> = {}) => ({
  marketId: id,
  address: `C${id}`,
  seller: "G1",
  quotaAsset: "C9",
  totalQuotas: 1000,
  minPricePerQuota: 500n,
  closeLedger: 100,
  graceLedgers: 60,
  finalizeByLedger: 160,
  status: "Open" as const,
  bidCount: 0,
  contractsVersion: "v",
  supported: true,
  nextCheckLedger: 100,
  ...over,
});

describe("banco (passo 1.1, OP-07)", () => {
  it("applies migrations once and records them", () => {
    const db = openDb(":memory:");
    expect(migrate(db)).toEqual([]);
    expect(db.prepare("SELECT name FROM schema_migrations").all()).toEqual([{ name: "0001_init.sql" }]);
  });

  it("applies a new migration file once", () => {
    const dir = mkdtempSync(join(tmpdir(), "mig-"));
    writeFileSync(join(dir, "0001_a.sql"), "CREATE TABLE a (x INTEGER);");
    const db = openDb(":memory:", { migrationsDir: dir });
    writeFileSync(join(dir, "0002_b.sql"), "CREATE TABLE b (x INTEGER);");
    expect(migrate(db, dir)).toEqual(["0002_b.sql"]);
    expect(migrate(db, dir)).toEqual([]);
  });

  it("MarketRepo lists due markets by next_check_ledger and terminal ones leave the schedule", () => {
    const r = repos(openDb(":memory:"));
    r.markets.insert(market(1n, { nextCheckLedger: 100 }));
    r.markets.insert(market(2n, { nextCheckLedger: 200 }));
    r.markets.insert(market(3n, { nextCheckLedger: null }));
    expect(r.markets.due(150).map((m) => m.marketId)).toEqual([1n]);
    r.markets.setNextCheck(1n, null, 0);
    expect(r.markets.due(1_000).map((m) => m.marketId)).toEqual([2n]);
    expect(r.markets.makeAllDue(0)).toBe(1);
    expect(r.markets.get(3n)?.nextCheckLedger).toBeNull();
  });

  it("u64 market ids round-trip as bigint and list in numeric order", () => {
    const r = repos(openDb(":memory:"));
    const big = 18_446_744_073_709_551_615n;
    r.markets.insert(market(big));
    r.markets.insert(market(10n));
    r.markets.insert(market(9n));
    expect(r.markets.get(big)?.marketId).toBe(big);
    expect(r.markets.list({ limit: 10 }).map((m) => m.marketId)).toEqual([9n, 10n, big]);
    expect(r.markets.list({ limit: 10, after: 9n }).map((m) => m.marketId)).toEqual([10n, big]);
  });

  it("updateState marks terminal_at once", () => {
    const r = repos(openDb(":memory:"));
    r.markets.insert(market(1n));
    r.markets.updateState(1n, { status: "Settled", bidCount: 2, finalizeByLedger: 160, unsold: 3, ledger: 200 });
    const m = r.markets.get(1n)!;
    expect(m).toMatchObject({ status: "Settled", bidCount: 2, unsold: 3, lastSyncedLedger: 200 });
    expect(m.terminalAt).not.toBeNull();
  });

  it("AlertRepo dedups an open alert and reopens after ack", () => {
    const r = repos(openDb(":memory:"));
    const a = { severity: "warning" as const, kind: "X", marketId: 1n, bidIndex: null, message: "m", dedupKey: "k" };
    expect(r.alerts.open(a)).toBe(true);
    expect(r.alerts.open(a)).toBe(false);
    const [row] = r.alerts.list({ limit: 5 });
    expect(r.alerts.ack(row!.id)).toBe(true);
    expect(r.alerts.open(a)).toBe(true);
    expect(r.alerts.countOpen()).toBe(1);
  });

  it("schema has no column for price, amount or opening (OP-16)", () => {
    const db = openDb(":memory:");
    const cols = (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table'").all() as { sql: string }[])
      .map((r) => r.sql)
      .join("\n")
      .replace(/--.*$/gm, "");
    for (const banned of ["price ", "clearing", "blinding", "nullifier_seed", "amount", "collateral", "refund", "envelope", "payment"]) {
      expect(cols.toLowerCase()).not.toContain(banned);
    }
  });
});

describe("lease (OP-06)", () => {
  it("one holder at a time; expires; renews; releases", () => {
    const r = repos(openDb(":memory:"));
    let now = 0;
    const a = new InstanceLease({ meta: r.meta, holder: "a", ttlMs: 100, now: () => now });
    const b = new InstanceLease({ meta: r.meta, holder: "b", ttlMs: 100, now: () => now });
    expect(a.acquire()).toBe(true);
    expect(b.acquire()).toBe(false);
    now = 90;
    expect(a.acquire()).toBe(true);
    now = 150;
    expect(b.acquire()).toBe(false);
    now = 191;
    expect(b.acquire()).toBe(true);
    expect(a.acquire()).toBe(false);
    b.release();
    expect(a.acquire()).toBe(true);
  });
});
