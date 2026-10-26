import type { BidStatus, MarketStatus } from "@zolvency-cmi/core";
import { describe, expect, it } from "vitest";

import { planNextAction, type KeeperAction, type MarketSnapshot } from "../../src/index.js";

const CLOSE = 1_000;
const FINALIZE_BY = CLOSE + 17_280;

function snap(state: MarketStatus, bids: [BidStatus, boolean][] = []): MarketSnapshot {
  return {
    state,
    closeLedger: CLOSE,
    finalizeByLedger: state === "Created" || state === "Open" ? null : FINALIZE_BY,
    bids: bids.map(([status, delegationLive]) => ({ status, delegationLive })),
  };
}

const P = (live = true): [BidStatus, boolean] => ["Pending", live];
const S: [BidStatus, boolean] = ["Settled", false];
const F: [BidStatus, boolean] = ["Failed", false];

const TABLE: [string, MarketSnapshot, number, KeeperAction][] = [
  ["Open before close → wait", snap("Open", [P()]), CLOSE - 1, { kind: "wait", untilLedger: CLOSE }],
  ["Open at close → close", snap("Open", [P()]), CLOSE, { kind: "close" }],
  ["Open at close without bids → close (the contract cancels it)", snap("Open"), CLOSE, { kind: "close" }],
  ["Created before close → wait (the seller has not opened it)", snap("Created"), CLOSE - 1, { kind: "wait", untilLedger: CLOSE }],
  ["Created at close → done (nothing the keeper can do)", snap("Created"), CLOSE, { kind: "done" }],
  ["Closed within grace → finalize", snap("Closed", [P()]), CLOSE + 1, { kind: "finalize" }],
  ["Closed at finalize_by → finalize (still within grace)", snap("Closed", [P()]), FINALIZE_BY, { kind: "finalize" }],
  ["Closed at finalize_by + 1 → cancel_expired", snap("Closed", [P()]), FINALIZE_BY + 1, { kind: "cancel_expired" }],
  ["Finalized with pending bid and live delegation → settle(lowest pending index)", snap("Finalized", [S, P(), P()]), CLOSE + 10, { kind: "settle", bidIndex: 1 }],
  ["Finalized with pending bid and gone delegation → release_unsettled", snap("Finalized", [S, P(false), P()]), CLOSE + 10, { kind: "release_unsettled", bidIndex: 1 }],
  ["Cancelled with pending bids → settle (refund)", snap("Cancelled", [F, P()]), FINALIZE_BY + 2, { kind: "settle", bidIndex: 1 }],
  ["Cancelled with pending bid and gone delegation → release_unsettled", snap("Cancelled", [P(false)]), FINALIZE_BY + 2, { kind: "release_unsettled", bidIndex: 0 }],
  ["all bids Settled or Failed → done", snap("Finalized", [S, F, S]), CLOSE + 10, { kind: "done" }],
  ["Settled with no pending → done", snap("Settled", [S, S]), CLOSE + 10, { kind: "done" }],
  ["Cancelled with no pending → done", snap("Cancelled", [S, F]), FINALIZE_BY + 2, { kind: "done" }],
  ["Cancelled without bids → done", snap("Cancelled"), CLOSE, { kind: "done" }],
];

describe("planNextAction (passo 5.4)", () => {
  it.each(TABLE)("%s", (_name, s, ledger, expected) => {
    expect(planNextAction(s, ledger)).toEqual(expected);
  });

  it("covers every (market state, bid state, delegation) pair", () => {
    const states: MarketStatus[] = ["Created", "Open", "Closed", "Finalized", "Settled", "Cancelled"];
    const bids: [BidStatus, boolean][] = [P(), P(false), S, F];
    for (const state of states) {
      for (const bid of bids) {
        for (const ledger of [CLOSE - 1, CLOSE, FINALIZE_BY, FINALIZE_BY + 1]) {
          const a = planNextAction(snap(state, [bid]), ledger);
          expect(["wait", "close", "finalize", "cancel_expired", "settle", "release_unsettled", "done"]).toContain(a.kind);

          if (a.kind === "settle" || a.kind === "release_unsettled") {
            expect(bid[0]).toBe("Pending");
            expect(["Finalized", "Cancelled"]).toContain(state);
            expect(a.kind === "settle").toBe(bid[1]);
          }
        }
      }
    }
  });
});
