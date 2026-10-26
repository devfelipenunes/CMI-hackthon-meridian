import type { KeeperAction } from "@zolvency-cmi/operator";
import { describe, expect, it } from "vitest";

import { deadlineLevel, nextCheck, orderDue, type DueMarket } from "../../src/scheduler/next-check.js";

const tuning = { reconcileLedgers: 60, backoffMaxLedgers: 120 };
const L = 1_000;
const base = { failed: false, ledger: L, backoffAttempts: 0, finalizeByLedger: 5_000, tuning };
const at = (action: KeeperAction | null, over: Partial<typeof base> = {}) => nextCheck({ ...base, action, ...over });

describe("nextCheck (passo 2.4, ARCHITECTURE §2.4)", () => {
  it.each<[string, KeeperAction | null, Partial<typeof base>, number | null, number]>([
    ["wait far away → reconcile", { kind: "wait", untilLedger: L + 10_000 }, {}, L + 60, 0],
    ["wait near → the ledger asked", { kind: "wait", untilLedger: L + 7 }, {}, L + 7, 0],
    ["wait in the past → next ledger", { kind: "wait", untilLedger: L - 5 }, {}, L + 1, 0],
    ["wait keeps the backoff count", { kind: "wait", untilLedger: L + 1 }, { backoffAttempts: 3 }, L + 1, 3],
    ["done → out of the schedule", { kind: "done" }, { backoffAttempts: 2 }, null, 0],
    ["close done → next ledger", { kind: "close" }, {}, L + 1, 0],
    ["finalize done → next ledger, backoff reset", { kind: "finalize" }, { backoffAttempts: 4 }, L + 1, 0],
    ["settle done → next ledger", { kind: "settle", bidIndex: 0 }, {}, L + 1, 0],
    ["release done → next ledger", { kind: "release_unsettled", bidIndex: 1 }, {}, L + 1, 0],
    ["finalize failed once → 2 ledgers", { kind: "finalize" }, { failed: true }, L + 2, 1],
    ["finalize failed 3 times → 16 ledgers", { kind: "finalize" }, { failed: true, backoffAttempts: 3 }, L + 16, 4],
    ["backoff is capped", { kind: "close" }, { failed: true, backoffAttempts: 20 }, L + 120, 21],
    ["finalize backoff never passes finalize_by − 1", { kind: "finalize" }, { failed: true, backoffAttempts: 6, finalizeByLedger: L + 10 }, L + 9, 7],
    ["at the deadline it tries every ledger", { kind: "finalize" }, { failed: true, backoffAttempts: 6, finalizeByLedger: L + 1 }, L + 1, 7],
    ["read failure (no action) backs off", null, { failed: true }, L + 2, 1],
    ["settle failed → next ledger (quarantine is the keeper's)", { kind: "settle", bidIndex: 2 }, { failed: true, backoffAttempts: 1 }, L + 1, 1],
  ])("%s", (_name, action, over, next, attempts) => {
    expect(at(action, over)).toEqual({ next, backoffAttempts: attempts });
  });
});

describe("orderDue (OP-17)", () => {
  const m = (id: number, status: DueMarket["status"], closeLedger = 0, finalizeByLedger = 0): DueMarket => ({ marketId: BigInt(id), status, closeLedger, finalizeByLedger });

  it("Closed nearest to deadline first, then due closes, then settlements, then reconciliations", () => {
    const ordered = orderDue([m(1, "Open", 2_000), m(2, "Finalized"), m(3, "Closed", 0, 900), m(4, "Open", 500), m(5, "Closed", 0, 800), m(6, "Cancelled"), m(7, "Created", 5_000)], L);
    expect(ordered.map((x) => Number(x.marketId))).toEqual([5, 3, 4, 2, 6, 1, 7]);
  });
});

describe("deadlineLevel (RF-19)", () => {
  it.each<[string, number, string, number | null]>([
    ["far", 5_000, "Closed", null],
    ["warning at warn ledgers", L + 720, "Closed", 1],
    ["critical at half", L + 360, "Closed", 2],
    ["past the deadline: no deadline alert (TimedOut speaks)", L - 1, "Closed", null],
    ["only Closed markets", L + 10, "Finalized", null],
  ])("%s", (_n, finalizeByLedger, status, expected) => {
    const lvl = deadlineLevel({ status: status as DueMarket["status"], finalizeByLedger }, L, 720);
    expect(lvl).toBe(expected === null ? null : expected === 1 ? "warning" : "critical");
  });
});
