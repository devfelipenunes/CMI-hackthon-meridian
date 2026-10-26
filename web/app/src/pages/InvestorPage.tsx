import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { CmiError, type BidStatus } from "@zolvency-cmi/core";
import { ArrowUpRight, LockKeyhole } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";

import type { MarketView, MyBidView } from "@zolvency-cmi/client";
import { formatQuotas, formatXlmWithUnit } from "@/domain/amount";
import { statusLabel } from "@/domain/market";
import { cn } from "@/lib/cn";
import { useCmi } from "@/sdk/CmiProvider";
import { useNetwork } from "@/sdk/NetworkProvider";
import { useMarkets } from "@/sdk/useMarkets";
import { useMerge } from "@/sdk/useAccount";
import { Badge } from "@/ui/Badge";
import { Button, ButtonLink } from "@/ui/Button";
import { EmptyState, ErrorNotice, LoadingRows } from "@/ui/Feedback";
import { InlineNote, PageHeader, Section } from "@/ui/Layout";
import { useWallet } from "@/wallet/WalletProvider";

const BID_STATUS: Record<BidStatus, { label: string; tone: "neutral" | "success" | "danger" | "progress" }> = {
  Pending: { label: "Awaiting allocation", tone: "progress" },
  Settled: { label: "Settled", tone: "success" },
  Failed: { label: "No allocation", tone: "neutral" },
};

function isMissingBid(error: unknown): boolean {
  return error instanceof CmiError && error.code === "Auction.BidNotFound";
}

function outOfOperatorReach(market: MarketView, data: MyBidView, ledger: number | null): boolean {
  if (data.status !== "Pending") return false;
  if (market.status === "Cancelled") return true;
  return market.status === "Closed" && market.finalizeByLedger !== null && ledger !== null && ledger > market.finalizeByLedger;
}

export function InvestorPage() {
  const { address, mode, setMode } = useWallet();
  const cmi = useCmi();
  const markets = useMarkets();
  const merge = useMerge();
  const { ledger } = useNetwork();

  const receiving = useQuery({
    queryKey: ["account", address, "receiving"],
    enabled: address !== null && cmi !== null,
    queryFn: async () => {
      if (cmi === null) throw new Error("wallet not connected");
      await cmi.client.account.sync();
      return (await cmi.client.account.balance()).receiving;
    },
  });

  const candidates = useMemo(
    () => (markets.data ?? []).filter((market) => market.status !== "Created" && market.bidCount > 0),
    [markets.data],
  );

  const bids = useQueries({
    queries: candidates.map((market) => ({
      queryKey: ["my-bid", address, market.marketId.toString()],
      enabled: address !== null && cmi !== null,
      queryFn: async () => {
        if (cmi === null) throw new Error("wallet not connected");
        return cmi.client.bidder.status(market.marketId);
      },

      retry: false,
    })),
  });

  if (address === null) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow="Investor"
          title="My bids"
          description="Every bid is a sealed commitment. Here you see what you requested, what was allocated and the decrypted refund."
        />
        <div className="border-y border-line py-10 text-center">
          <p className="text-sm text-ink-2">Connect your wallet to see your bids on this network.</p>
          <ButtonLink to="/wallet" className="mt-4">
            Connect wallet
          </ButtonLink>
        </div>
      </div>
    );
  }

  const rows = candidates
    .map((market, index) => ({ market, result: bids[index] }))
    .filter(({ result }) => result !== undefined && result.data !== undefined);

  const pending = rows.some(
    ({ market, result }) => result?.data?.status === "Pending" && !outOfOperatorReach(market, result.data, ledger),
  );
  const toReceive = receiving.data ?? 0n;

  return (
    <div>
      <PageHeader
        eyebrow="Investor"
        title="My bids"
        description="Requested quantity is public; the price appears only here, decrypted with your own key. None of it is sent to a server."
      />

      {mode !== "investor" && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-l-2 border-primary bg-primary-soft/60 px-4 py-3">
          <p className="text-[13px] text-ink-2">You are in Company mode.</p>
          <button type="button" onClick={() => setMode("investor")} className="text-[13px] font-semibold text-primary">
            Switch to Investor mode
          </button>
        </div>
      )}

      <Section
        title="In progress and completed"
        id="bids"
        aside={
          rows.length > 0 ? (
            <span className="numeric text-[12px] text-ink-3">
              {rows.length} {rows.length === 1 ? "bid" : "bids"}
            </span>
          ) : undefined
        }
      >
        {markets.isPending || (address !== null && cmi !== null && candidates.length > 0 && bids.some((result) => result.isPending)) ? (
          <LoadingRows rows={3} />
        ) : markets.isError ? (
          <ErrorNotice error={markets.error} onRetry={() => void markets.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No bids on this wallet"
            detail="Pick an open auction and place a bid. The price stays in the browser until allocation."
            mono="bidder has no bids"
            action={<ButtonLink to="/">View auctions</ButtonLink>}
          />
        ) : (
          <div className="rule-list">
            {rows.map(({ market, result }) => (
              <BidRow key={market.marketId.toString()} market={market} data={result?.data ?? null} />
            ))}
          </div>
        )}
        {bids.some((result) => result.isError && !isMissingBid(result.error)) && (
          <ErrorNotice error={bids.find((result) => result.isError && !isMissingBid(result.error))?.error} className="mt-4" />
        )}
      </Section>

      <Section title="Refunds" id="refunds">
        <div className="rounded-sheet border border-line bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-prose">
              <p className="numeric text-[22px] font-semibold tracking-tight">
                {formatXlmWithUnit(toReceive)}
                <span className="ml-2 text-[12px] font-normal text-ink-3">to receive</span>
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
                {toReceive > 0n
                  ? "Refunds have arrived in the confidential account. Receive them to make them spendable."
                  : pending
                    ? "Some bids are still awaiting allocation. The refund appears after the operator settles your bid."
                    : "Nothing to receive right now. Whatever was not spent on a bid arrives here after settlement."}
              </p>
            </div>
            <Button variant="secondary" onClick={() => merge.mutate()} loading={merge.isPending} disabled={toReceive === 0n}>
              Receive refunds
            </Button>
          </div>
          {receiving.isError && <ErrorNotice error={receiving.error} className="mt-4" />}
          {merge.isError && <ErrorNotice error={merge.error} className="mt-4" />}
          {merge.isSuccess && <p className="mt-3 text-[13px] text-success">Refunds available in the confidential account.</p>}
        </div>
        <InlineNote>
          The contract computes the refund from your bid price; the app only decrypts it with your key.
          Outside the RPC window, an old value shows as unavailable — never as zero.
        </InlineNote>
      </Section>

      <div className="mt-2 flex items-start gap-2 text-[12px] leading-relaxed text-ink-3">
        <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
        <p>A bid price exists only in this tab while you fill the form; after submission, it is not stored.</p>
      </div>
    </div>
  );
}

function BidRow({ market, data }: { market: MarketView; data: MyBidView | null }) {
  const { ledger } = useNetwork();
  if (data === null) return null;
  const status = outOfOperatorReach(market, data, ledger)
    ? { label: market.status === "Cancelled" ? "Auction cancelled" : "Settlement deadline passed", tone: "neutral" as const }
    : BID_STATUS[data.status];
  const refundPending = data.status === "Settled" && data.refund === null && (market.status === "Settled" || market.status === "Finalized");

  return (
    <div className="row-link grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-4 sm:grid-cols-[80px_minmax(0,1.2fr)_minmax(0,1fr)_auto_18px]">
      <Link to={`/market/${market.marketId}`} className="numeric text-[13px] text-ink-3 hover:text-ink">
        #{market.marketId.toString()}
      </Link>
      <div className="col-start-1 min-w-0 sm:col-start-auto">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          <span className="truncate text-sm font-medium">{formatQuotas(data.requested)} requested</span>
        </div>
        <p className="mt-1 text-[12px] text-ink-3">
          Auction {statusLabel(market.status).toLowerCase()} · {formatQuotas(market.totalQuotas)}
        </p>
      </div>
      <div className="text-left sm:text-right">
        <p className="numeric text-sm font-medium">{formatQuotas(data.filled)}</p>
        <p className="text-[12px] text-ink-3">quotas allocated</p>
      </div>
      <div className={cn("text-left sm:text-right", refundPending && "sm:max-w-[150px]")}>
        <p className="numeric text-sm font-medium">
          {data.refund === null ? "—" : `${formatXlmWithUnit(data.refund)} refunded`}
        </p>
        <p className="text-[12px] text-ink-3">
          {refundPending ? "outside the RPC history" : data.status === "Settled" ? "refund decrypted" : "after settlement"}
        </p>
      </div>
      <Link
        to={`/market/${market.marketId}`}
        aria-label={`Open auction ${market.marketId.toString()}`}
        className="hidden text-ink-3 transition-colors hover:text-ink sm:block"
      >
        <ArrowUpRight className="h-4 w-4" aria-hidden />
      </Link>
      <RecoverCollateral market={market} data={data} />
    </div>
  );
}

function RecoverCollateral({ market, data }: { market: MarketView; data: MyBidView }) {
  const { address } = useWallet();
  const cmi = useCmi();
  const { ledger } = useNetwork();
  const queryClient = useQueryClient();
  const eligible = outOfOperatorReach(market, data, ledger);

  const delegation = useQuery({
    queryKey: ["delegation", address, market.address],
    enabled: eligible && address !== null && cmi !== null,
    queryFn: async () => {
      if (cmi === null || address === null) throw new Error("wallet not connected");
      return cmi.client.token.delegation(address, market.address);
    },
  });

  const recover = useMutation({
    mutationFn: async () => {
      if (cmi === null) throw new Error("wallet not connected");
      return cmi.client.bidder.recoverCollateral(market.marketId);
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["delegation", address, market.address] }),
        queryClient.invalidateQueries({ queryKey: ["account"] }),
      ]),
  });

  if (recover.isSuccess) {
    return <p className="col-span-full text-[13px] text-success">Collateral returned to the balance.</p>;
  }
  if (!eligible || delegation.data === undefined || delegation.data === null) return null;

  return (
    <div className="col-span-full flex flex-wrap items-center justify-between gap-3 border-l-2 border-warning bg-warning/[0.05] px-4 py-3">
      <p className="max-w-prose text-[13px] text-ink-2">
        This bid will not be settled by the operator. Your collateral is still locked for this auction; recovering it
        returns the amount to your confidential balance.
      </p>
      <Button variant="secondary" size="sm" loading={recover.isPending} onClick={() => recover.mutate()}>
        Recover collateral
      </Button>
      {recover.isError && <ErrorNotice error={recover.error} className="w-full" />}
    </div>
  );
}
