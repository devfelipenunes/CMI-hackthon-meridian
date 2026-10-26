import type { AuctionEvent } from "@zolvency-cmi/core";

import { sum } from "@/domain/amount";
import { formatLedger } from "@/domain/time";
import { EmptyState } from "@/ui/Feedback";

interface Line {
  ledger: number;
  title: string;
  detail: string;
  tone: "neutral" | "accent" | "success" | "danger";
}

function lineOf(event: AuctionEvent): Line {
  switch (event.kind) {
    case "MarketOpened":
      return {
        ledger: event.ledger,
        title: "Auction opened",
        detail: `${event.totalQuotas.toLocaleString("en-US")} quotas locked in custody.`,
        tone: "accent",
      };
    case "ParticipantRegistered":
      return { ledger: event.ledger, title: "Participant registered", detail: `Participant #${event.participantId}.`, tone: "neutral" };
    case "BidAccepted":
      return {
        ledger: event.ledger,
        title: "Bid received",
        detail: `${event.requestedQuantity.toLocaleString("en-US")} quotas requested; sealed price.`,
        tone: "accent",
      };
    case "MarketClosed":
      return {
        ledger: event.ledger,
        title: "Bidding closed",
        detail: `${event.bidCount} ${event.bidCount === 1 ? "bid accepted" : "bids accepted"}. Finalization by ${formatLedger(event.finalizeByLedger)}.`,
        tone: "neutral",
      };
    case "MarketFinalized":
      return {
        ledger: event.ledger,
        title: "Allocation finalized",
        detail: `${sum(event.filled).toLocaleString("en-US")} quotas allocated; ${event.unsold.toLocaleString("en-US")} unsold.`,
        tone: "success",
      };
    case "BidSettled":
      return {
        ledger: event.ledger,
        title: "Bid settled",
        detail: `${event.filledQuantity.toLocaleString("en-US")} quotas delivered to the participant.`,
        tone: "success",
      };
    case "BidFailed":
      return {
        ledger: event.ledger,
        title: "Bid not settled",
        detail: "The collateral returns to the participant.",
        tone: "danger",
      };
    case "MarketSettled":
      return { ledger: event.ledger, title: "Auction completed", detail: "Quotas and payments settled.", tone: "success" };
    case "MarketCancelled":
      return {
        ledger: event.ledger,
        title: "Auction cancelled",
        detail:
          event.reason === "seller"
            ? "Cancelled by the seller. Quotas and collateral are returned."
            : event.reason === "no_bids"
              ? "Closed without bids. Quotas and collateral are returned."
              : "Cancelled after the finalization timeout. Quotas and collateral are returned.",
        tone: "danger",
      };
  }
}

const dot: Record<Line["tone"], string> = {
  neutral: "bg-ink-3",
  accent: "bg-accent",
  success: "bg-success",
  danger: "bg-danger",
};

export function MarketTimeline({ events }: { events: AuctionEvent[] }) {
  const lines = events.map(lineOf).sort((a, b) => b.ledger - a.ledger);
  if (lines.length === 0) {
    return <EmptyState title="No events yet" detail="The auction opening appears here as soon as the seller locks the quotas." mono="on-chain" />;
  }
  return (
    <ol className="relative space-y-0 border-y border-line">
      {lines.map((line, index) => (
        <li key={`${line.ledger}-${line.title}-${index}`} className="grid grid-cols-[16px_minmax(0,1fr)_auto] gap-3 border-b border-line py-3.5 last:border-b-0">
          <span className="relative mt-1.5 flex justify-center">
            {index < lines.length - 1 && <span className="absolute top-2.5 h-[calc(100%+14px)] w-px bg-line" aria-hidden />}
            <span className={`relative h-1.5 w-1.5 rounded-full ${dot[line.tone]}`} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium">{line.title}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3">{line.detail}</p>
          </div>
          <span className="numeric pt-0.5 text-[11.5px] text-ink-3">{line.ledger.toLocaleString("en-US")}</span>
        </li>
      ))}
    </ol>
  );
}
