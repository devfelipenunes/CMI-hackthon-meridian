import type { BidStatus, MarketStatus } from "@zolvency-cmi/core";

export interface MarketSnapshot {
  state: MarketStatus;
  closeLedger: number;

  finalizeByLedger: number | null;

  bids: { status: BidStatus; delegationLive: boolean }[];
}

export type KeeperAction =
  | { kind: "close" }
  | { kind: "finalize" }
  | { kind: "cancel_expired" }
  | { kind: "settle"; bidIndex: number }
  | { kind: "release_unsettled"; bidIndex: number }
  | { kind: "wait"; untilLedger: number }
  | { kind: "done" };

export function planNextAction(s: MarketSnapshot, ledger: number): KeeperAction {
  switch (s.state) {
    case "Created":
      return ledger < s.closeLedger ? { kind: "wait", untilLedger: s.closeLedger } : { kind: "done" };
    case "Open":
      return ledger < s.closeLedger ? { kind: "wait", untilLedger: s.closeLedger } : { kind: "close" };
    case "Closed":
      return s.finalizeByLedger !== null && ledger > s.finalizeByLedger ? { kind: "cancel_expired" } : { kind: "finalize" };
    case "Finalized":
    case "Cancelled": {
      const bidIndex = s.bids.findIndex((b) => b.status === "Pending");
      if (bidIndex < 0) return { kind: "done" };
      return s.bids[bidIndex]!.delegationLive ? { kind: "settle", bidIndex } : { kind: "release_unsettled", bidIndex };
    }
    case "Settled":
      return { kind: "done" };
  }
}
