import type { MarketView } from "@zolvency-cmi/client";
import type { AuctionEvent, MarketStatus } from "@zolvency-cmi/core";

import { sum } from "./amount";
import { formatLedger } from "./time";

export type Role = "company" | "investor";
export type Tone = "neutral" | "live" | "progress" | "success" | "danger";

const STATUS_LABEL: Record<MarketStatus, string> = {
  Created: "Not open",
  Open: "Open",
  Closed: "Closed",
  Finalized: "Finalized",
  Settled: "Settled",
  Cancelled: "Cancelled",
};

const STATUS_TONE: Record<MarketStatus, Tone> = {
  Created: "neutral",
  Open: "live",
  Closed: "progress",
  Finalized: "progress",
  Settled: "success",
  Cancelled: "danger",
};

export const statusLabel = (status: MarketStatus): string => STATUS_LABEL[status];
export const statusTone = (status: MarketStatus): Tone => STATUS_TONE[status];

export const STATUS_ORDER: readonly MarketStatus[] = ["Open", "Created", "Closed", "Finalized", "Settled", "Cancelled"];

export type MarketActionKind = "bid" | "close" | "cancel-expired" | "open" | "cancel" | "proceeds";

export interface MarketAction {
  kind: MarketActionKind;
  label: string;

  to?: string;
  tone: "primary" | "secondary" | "danger";
}

export interface ActionContext {
  market: MarketView;
  mode: Role | null;
  me: string | null;
  ledger: number;
}

export function actionsFor({ market, mode, me, ledger }: ActionContext): MarketAction[] {
  const actions: MarketAction[] = [];
  const isSeller = me !== null && market.seller === me;
  const biddingOpen = market.status === "Open" && ledger < market.closeLedger;

  if (biddingOpen && mode === "investor" && me !== null) {
    actions.push({ kind: "bid", label: "Place bid", to: `/market/${market.marketId}/bid`, tone: "primary" });
  }

  if (market.status === "Open" && ledger >= market.closeLedger && me !== null) {
    actions.push({ kind: "close", label: "Close auction", tone: "secondary" });
  }

  if (market.status === "Closed" && market.finalizeByLedger !== null && ledger > market.finalizeByLedger && me !== null) {
    actions.push({ kind: "cancel-expired", label: "Cancel after timeout", tone: "danger" });
  }

  if (isSeller && market.status === "Created") {
    actions.push({ kind: "open", label: "Open (lock quotas)", tone: "primary" });
    actions.push({ kind: "cancel", label: "Cancel auction", tone: "danger" });
  }

  if (isSeller && market.status === "Open" && market.bidCount === 0) {
    actions.push({ kind: "cancel", label: "Cancel auction", tone: "danger" });
  }

  if (isSeller && market.status === "Settled") {
    actions.push({ kind: "proceeds", label: "View proceeds", to: `/company/market/${market.marketId}`, tone: "secondary" });
  }

  return actions;
}

export interface OperatorProgress {
  title: string;
  detail: string;
  tone: Tone;
}

export function operatorProgress({
  market,
  ledger,
  events,
}: {
  market: MarketView;
  ledger: number;
  events: readonly AuctionEvent[];
}): OperatorProgress {
  if (market.status === "Created") {
    return { title: "Waiting to open", detail: "The seller has not locked the quotas in custody yet.", tone: "neutral" };
  }

  if (market.status === "Open") {
    if (ledger < market.closeLedger) {
      return { title: "Bidding open", detail: `Bids run until ${formatLedger(market.closeLedger)}.`, tone: "live" };
    }
    return {
      title: "Ready to close",
      detail: "The bidding deadline has passed; any wallet can close the auction.",
      tone: "progress",
    };
  }

  if (market.status === "Closed") {
    if (market.finalizeByLedger !== null && ledger > market.finalizeByLedger) {
      return {
        title: "Operator late",
        detail: "The finalization deadline has passed; any wallet can cancel and return everything.",
        tone: "danger",
      };
    }
    const deadline = market.finalizeByLedger === null ? "the grace deadline" : formatLedger(market.finalizeByLedger);
    return { title: "Awaiting finalization", detail: `The operator has until ${deadline} to finalize the results.`, tone: "progress" };
  }

  if (market.status === "Finalized") {
    const settled = events.filter((event) => event.kind === "BidSettled").length;
    const failed = events.filter((event) => event.kind === "BidFailed").length;
    const done = settled + failed;
    if (market.bidCount > 0 && done >= market.bidCount) {
      return {
        title: "Settlement complete",
        detail: `${settled} ${settled === 1 ? "bid settled" : "bids settled"}${failed > 0 ? `, ${failed} failed` : ""}.`,
        tone: "success",
      };
    }
    return {
      title: `Settling ${done} of ${market.bidCount}`,
      detail: "The operator settles one bid per ledger.",
      tone: "progress",
    };
  }

  if (market.status === "Settled") {
    const filled = market.allocation === null ? null : sum(market.allocation);
    return {
      title: "Completed",
      detail: filled === null ? "Settlement complete." : `${filled} of ${market.totalQuotas} quotas sold.`,
      tone: "success",
    };
  }

  const reason = events.find((event) => event.kind === "MarketCancelled") as { kind: "MarketCancelled"; reason: string } | undefined;
  const reasonText =
    reason?.reason === "seller"
      ? "The seller cancelled."
      : reason?.reason === "no_bids"
        ? "The auction closed without bids."
        : reason?.reason === "expired"
          ? "The operator did not finalize in time."
          : "Locked quotas and values can be returned.";
  return { title: "Auction cancelled", detail: reasonText, tone: "danger" };
}

export function totalAllocated(allocation: readonly number[] | null): number | null {
  return allocation === null ? null : sum(allocation);
}
