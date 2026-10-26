import { ArrowRight, LockKeyhole } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { MarketRow } from "@/components/MarketRow";
import { formatCountdown, countdown, ledgerToDate } from "@/domain/time";
import { cn } from "@/lib/cn";
import { useNetwork, useNow } from "@/sdk/NetworkProvider";
import { useMarkets } from "@/sdk/useMarkets";
import { ButtonLink } from "@/ui/Button";
import { EmptyState, ErrorNotice, LoadingRows } from "@/ui/Feedback";
import { useWallet } from "@/wallet/WalletProvider";

const ORDER = { Open: 0, Created: 1, Closed: 2, Finalized: 3, Settled: 4, Cancelled: 5 } as const;

export function HomePage() {
  const { ledger, anchor } = useNetwork();
  const now = useNow();
  const { mode } = useWallet();
  const markets = useMarkets();
  const [filter, setFilter] = useState<"active" | "all">("active");

  const all = useMemo(() => markets.data ?? [], [markets.data]);
  const active = useMemo(() => all.filter((market) => market.status === "Open" || market.status === "Created"), [all]);
  const shown = useMemo(() => {
    const list = filter === "active" ? active : all;
    return [...list].sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || Number(b.marketId - a.marketId));
  }, [filter, all, active]);

  const open = all.filter((market) => market.status === "Open");
  const nextClose = useMemo(() => {
    if (ledger === null) return null;
    const upcoming = open.filter((market) => market.closeLedger > ledger).sort((a, b) => a.closeLedger - b.closeLedger);
    return upcoming[0] ?? null;
  }, [open, ledger]);

  return (
    <div>
      <section className="border-b border-line pb-8 pt-2">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <p className="label flex items-center gap-2">
              <LockKeyhole className="h-3 w-3" aria-hidden />
              Confidential auction · Stellar Testnet
            </p>
            <h1 className="mt-3 max-w-[18ch] text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[46px]">
              Quotas sold in sealed-bid auctions.
            </h1>
            <p className="mt-4 max-w-prose text-[15px] leading-relaxed text-ink-2">
              Companies lock quotas and set a floor. Investors submit bids with sealed price and quantity.
              The contract opens the bids, allocates from highest to lowest and settles on-chain — with no intermediary seeing the price.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              <a
                href="#auctions"
                className="inline-flex h-10 items-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
              >
                View auctions
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
              {mode === "company" && (
                <ButtonLink to="/company/new" variant="secondary">
                  Create auction
                </ButtonLink>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-3 gap-4 border-y border-line py-4 lg:border-y-0 lg:border-l lg:py-1 lg:pl-8">
            <Stat term="Open" value={markets.isPending ? "—" : String(open.length)} />
            <Stat
              term="Demand"
              value={markets.isPending ? "—" : open.reduce((total, market) => total + market.demand, 0).toLocaleString("en-US")}
              hint="quotas requested"
            />
            <Stat
              term="Next close"
              value={
                nextClose === null || anchor === null
                  ? "—"
                  : formatCountdown(countdown(ledgerToDate(nextClose.closeLedger, anchor), now))
              }
              hint={nextClose === null ? undefined : `auction #${nextClose.marketId.toString()}`}
            />
          </dl>
        </div>
      </section>

      <section id="auctions" className="scroll-mt-6 py-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-[17px] font-semibold tracking-tight">Auctions</h2>
          <div className="flex items-center gap-1 text-[12.5px]">
            {(
              [
                ["active", "Live"],
                ["all", "All"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={cn(
                  "rounded-full px-2.5 py-1 font-medium transition-colors",
                  filter === value ? "bg-primary-soft text-primary" : "text-ink-3 hover:bg-sunken hover:text-ink",
                )}
              >
                {label}
                {value === "active" && active.length > 0 && <span className="numeric ml-1 text-[11px] opacity-70">{active.length}</span>}
              </button>
            ))}
          </div>
        </div>

        {markets.isPending ? (
          <LoadingRows rows={4} />
        ) : markets.isError ? (
          <ErrorNotice error={markets.error} onRetry={() => void markets.refetch()} />
        ) : shown.length === 0 ? (
          filter === "active" && all.length > 0 ? (
            <EmptyState
              title="No live auctions"
              detail="All auctions on this testnet have closed. Check the history to follow finalization."
              action={
                <button type="button" className="text-sm font-semibold text-primary" onClick={() => setFilter("all")}>
                  View all auctions
                </button>
              }
              mono="no open auctions"
            />
          ) : (
            <EmptyState
              title="No auctions created yet"
              detail="When a company creates the first auction on this network, it appears here with public quotas and floor."
              action={mode === "company" ? <ButtonLink to="/company/new">Create the first auction</ButtonLink> : <ButtonLink to="/wallet" variant="secondary">Connect wallet</ButtonLink>}
              mono="factory has no markets yet"
            />
          )
        ) : (
          <div className="rule-list">
            {shown.map((market) => (
              <MarketRow key={market.marketId.toString()} market={market} ledger={ledger} anchor={anchor} now={now} />
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-8 border-t border-line py-9 sm:grid-cols-3">
        {[
          ["01", "Sealed price", "The bid reaches the contract as a commitment. Neither the seller nor the operator sees the price before finalization."],
          ["02", "Public floor", "The seller publishes quantity and minimum price. Demand appears; individual bids do not."],
          ["03", "On-chain settlement", "Allocation and payment run on-chain. All you need is a Stellar wallet and a confidential account in your browser."],
        ].map(([number, title, detail]) => (
          <div key={number}>
            <p className="numeric text-[11px] text-ink-3">{number}</p>
            <h2 className="mt-2 text-sm font-semibold">{title}</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{detail}</p>
          </div>
        ))}
      </section>

      <p className="border-t border-line py-5 text-[12px] leading-relaxed text-ink-3">
        Testnet: no real value is moved.{" "}
        <Link to="/wallet" className="font-medium text-ink-2 underline-offset-2 hover:underline">
          Set up your wallet
        </Link>{" "}
        to participate.
      </p>
    </div>
  );
}

function Stat({ term, value, hint }: { term: string; value: string; hint?: string | undefined }) {
  return (
    <div className="min-w-0">
      <dt className="label">{term}</dt>
      <dd className="numeric mt-1 truncate text-[20px] font-semibold tracking-tight">{value}</dd>
      {hint !== undefined && <dd className="mt-0.5 truncate text-[11.5px] text-ink-3">{hint}</dd>}
    </div>
  );
}
