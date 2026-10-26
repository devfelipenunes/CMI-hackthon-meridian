import type { MarketView } from "@zolvency-cmi/client";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

import { formatQuotas, formatXlm } from "@/domain/amount";
import { statusLabel, statusTone } from "@/domain/market";
import { countdown, formatCountdown, ledgerToDate, relativeToLedger, type LedgerAnchor } from "@/domain/time";
import { Badge } from "@/ui/Badge";
import { DemandBar } from "./DemandBar";

export function CloseLabel({ market, ledger, anchor, now }: { market: MarketView; ledger: number | null; anchor: LedgerAnchor | null; now: number }) {
  if (market.status === "Created") return <>Waiting to open</>;
  if (market.status === "Open") {
    if (ledger !== null && ledger >= market.closeLedger) return <>Ready to close</>;
    if (anchor !== null) {
      const date = ledgerToDate(market.closeLedger, anchor);
      return (
        <span title={`ledger ${market.closeLedger.toLocaleString("en-US")}`}>
          Closes in <span className="font-medium text-ink-2">{formatCountdown(countdown(date, now))}</span>
        </span>
      );
    }
    return <>Closes at ledger {market.closeLedger.toLocaleString("en-US")}</>;
  }
  if (market.status === "Closed" && market.finalizeByLedger !== null) return <>Finalization by ledger {market.finalizeByLedger.toLocaleString("en-US")}</>;
  if (market.status === "Finalized") return <>Settling bids</>;
  const closed = relativeToLedger(market.closeLedger, ledger, anchor);
  if (market.status === "Settled" && closed !== null) return <>Closed {closed}</>;
  return <>#{market.marketId.toString()}</>;
}

export function MarketRow({ market, ledger, anchor, now }: { market: MarketView; ledger: number | null; anchor: LedgerAnchor | null; now: number }) {
  return (
    <Link to={`/market/${market.marketId}`} className="row-link group grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 py-4 sm:grid-cols-[56px_minmax(0,1.5fr)_minmax(0,1fr)_170px_20px] sm:items-center">
      <div className="numeric text-[13px] text-ink-3">#{market.marketId.toString()}</div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(market.status)}>{statusLabel(market.status)}</Badge>
          <span className="truncate text-sm font-medium">{formatQuotas(market.totalQuotas)}</span>
        </div>
        <div className="mt-1.5 max-w-xs">
          <DemandBar demand={market.demand} totalQuotas={market.totalQuotas} compact />
        </div>
      </div>
      <div className="col-start-2 sm:col-start-auto">
        <p className="numeric text-sm font-medium">{formatXlm(market.minPricePerQuota)} XLM</p>
        <p className="text-[12px] text-ink-3">floor per quota</p>
      </div>
      <div className="col-start-2 text-[13px] text-ink-3 sm:col-start-auto">
        <CloseLabel market={market} ledger={ledger} anchor={anchor} now={now} />
      </div>
      <ChevronRight className="hidden h-4 w-4 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink-2 sm:block" aria-hidden />
    </Link>
  );
}
