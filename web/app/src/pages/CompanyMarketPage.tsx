import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Lock, LockOpen } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import type { MarketView } from "@zolvency-cmi/client";
import { MarketTimeline } from "@/components/MarketTimeline";
import { formatQuotas, formatXlm, formatXlmWithUnit } from "@/domain/amount";
import { errorTextFrom } from "@/domain/errors";
import { operatorProgress, statusLabel, statusTone } from "@/domain/market";
import { countdown, formatCountdown, ledgerToDate, relativeToLedger } from "@/domain/time";
import { useCmi } from "@/sdk/CmiProvider";
import { useNetwork, useNow } from "@/sdk/NetworkProvider";
import { readSacBalance } from "@/sdk/quota";
import { useMarketId } from "@/sdk/useMarketId";
import { useMarket, useMarketEvents } from "@/sdk/useMarkets";
import { useMerge } from "@/sdk/useAccount";
import { Address } from "@/ui/Address";
import { Badge } from "@/ui/Badge";
import { Button, ButtonLink } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { EmptyState, ErrorNotice, LoadingRows } from "@/ui/Feedback";
import { DefinitionList, DefinitionRow, InlineNote, PageHeader, Section } from "@/ui/Layout";
import { useWallet } from "@/wallet/WalletProvider";

type ManagementAction = "open" | "cancel" | "close" | "cancel-expired";

const ACTION_COPY: Record<ManagementAction, { title: string; description: string; confirm: string; danger: boolean }> = {
  open: {
    title: "Open the auction",
    description: "The offered quotas are locked in the contract until the auction ends or is cancelled.",
    confirm: "Sign and open",
    danger: false,
  },
  cancel: {
    title: "Cancel the auction",
    description: "The auction is closed and the locked quotas return to the company. Only possible before the first bid.",
    confirm: "Confirm cancellation",
    danger: true,
  },
  close: {
    title: "Close the auction",
    description: "No new bids are accepted. The operator then has the grace period to finalize allocation.",
    confirm: "Sign and close",
    danger: false,
  },
  "cancel-expired": {
    title: "Cancel after timeout",
    description: "The operator's finalization deadline has passed. Cancellation returns quotas and collateral; nothing is settled.",
    confirm: "Confirm cancellation",
    danger: true,
  },
};

export function CompanyMarketPage() {
  const id = useMarketId();
  const market = useMarket(id);
  const { address } = useWallet();
  const { ledger, anchor } = useNetwork();
  const now = useNow();
  const cmi = useCmi();
  const merge = useMerge();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<ManagementAction | null>(null);

  if (id === null) return <NotFound />;
  if (market.isPending) {
    return (
      <div className="mx-auto max-w-3xl">
        <LoadingRows rows={5} />
      </div>
    );
  }
  if (market.isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackLink />
        <ErrorNotice error={market.error} onRetry={() => void market.refetch()} className="mt-6" />
      </div>
    );
  }

  if (market.data === null) return <NotFound />;

  const view = market.data;
  const isSeller = address !== null && view.seller === address;
  if (!isSeller) {
    return (
      <div className="mx-auto max-w-2xl py-14">
        <EmptyState
          title="This auction does not belong to this wallet"
          detail="The management page is restricted to the seller. The public view shows the auction parameters and history."
          action={<ButtonLink to={`/market/${view.marketId}`}>Open public view</ButtonLink>}
        />
      </div>
    );
  }

  const closeDate = anchor === null ? null : ledgerToDate(view.closeLedger, anchor);
  const closeIn = relativeToLedger(view.closeLedger, ledger, anchor);
  const finalizeIn = view.finalizeByLedger === null ? null : relativeToLedger(view.finalizeByLedger, ledger, anchor);
  const canOpen = view.status === "Created";
  const canCancel = view.status === "Created" || (view.status === "Open" && view.bidCount === 0);
  const canClose = view.status === "Open" && ledger !== null && ledger >= view.closeLedger;
  const canCancelExpired = view.status === "Closed" && view.finalizeByLedger !== null && ledger !== null && ledger > view.finalizeByLedger;
  const settling = view.status === "Finalized" || view.status === "Settled";
  const needsProceeds = view.status === "Settled";

  return (
    <div className="mx-auto max-w-4xl">
      <BackLink />
      <PageHeader
        eyebrow={`Auction #${view.marketId.toString()}`}
        title="Auction management"
        description="Open, close and follow settlement. The company does not see bid prices; only what it received after settlement."
        className="mt-4"
        actions={
          <>
            <ButtonLink to={`/market/${view.marketId}`} variant="secondary" size="sm" icon={<ArrowUpRight className="h-3.5 w-3.5" aria-hidden />}>
              Public view
            </ButtonLink>
            <Badge tone={statusTone(view.status)}>{statusLabel(view.status)}</Badge>
          </>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_290px]">
        <div className="min-w-0">
          <DefinitionList>
            <DefinitionRow term="Quotas offered">{formatQuotas(view.totalQuotas)}</DefinitionRow>
            <DefinitionRow term="Floor per quota">{formatXlmWithUnit(view.minPricePerQuota)}</DefinitionRow>
            <DefinitionRow term="Bids received">{view.bidCount}</DefinitionRow>
            <DefinitionRow term="Public demand">{formatQuotas(view.demand)}</DefinitionRow>
            <DefinitionRow term="Close" hint={closeIn === null ? "time estimated from the ledger" : `${closeIn} (estimated)`}>
              ledger {view.closeLedger.toLocaleString("en-US")}
            </DefinitionRow>
            {view.finalizeByLedger !== null && (
              <DefinitionRow term="Finalization by" hint={finalizeIn === null ? undefined : `${finalizeIn} (estimated)`}>
                ledger {view.finalizeByLedger.toLocaleString("en-US")}
              </DefinitionRow>
            )}
            <DefinitionRow term="Quota asset">
              <Address value={view.quotaAsset} size={5} copy explorer />
            </DefinitionRow>
            <DefinitionRow term="Auction contract">
              <Address value={view.address} size={5} copy explorer />
            </DefinitionRow>
          </DefinitionList>

          <div className="mt-5">
            <SellerQuotaBalance quotaAsset={view.quotaAsset} seller={view.seller} />
          </div>

          {settling && <ProceedsSection market={view} />}

          <Section title="History" id="history">
            <EventsList market={view} />
          </Section>
        </div>

        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-sheet border border-line bg-surface p-5">
            <p className="label">Next action</p>
            {canOpen || canCancel || canClose || canCancelExpired ? (
              <div className="mt-3 flex flex-col gap-2">
                {canOpen && (
                  <Button onClick={() => setPending("open")} icon={<LockOpen className="h-4 w-4" aria-hidden />}>
                    Open and lock quotas
                  </Button>
                )}
                {canClose && (
                  <Button variant="secondary" onClick={() => setPending("close")}>
                    Close auction
                  </Button>
                )}
                {canCancelExpired && (
                  <Button variant="danger" onClick={() => setPending("cancel-expired")}>
                    Cancel after timeout
                  </Button>
                )}
                {canCancel && (
                  <Button variant="ghost" onClick={() => setPending("cancel")}>
                    Cancel auction
                  </Button>
                )}
              </div>
            ) : (
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                {view.status === "Created"
                  ? "Open the auction when the quotas are in the wallet."
                  : view.status === "Open"
                    ? "No action for you right now. Follow the close."
                    : settling
                      ? "Settlement belongs to the operator. Check the proceeds beside."
                      : "No action available in this state."}
              </p>
            )}

            {needsProceeds && (
              <Button variant="secondary" className="mt-2 w-full" loading={merge.isPending} onClick={() => merge.mutate()}>
                Receive payments
              </Button>
            )}
            {merge.isError && <ErrorNotice error={merge.error} className="mt-3" />}
            {merge.isSuccess && <p className="mt-2 text-[12.5px] text-success">Payments available in the confidential account.</p>}
          </div>

          <div className="mt-4 rounded-sheet border border-line p-5">
            <p className="label">Operator</p>
            <p className="mt-2 text-sm font-semibold">{operatorProgress({ market: view, ledger: ledger ?? 0, events: [] }).title}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
              {operatorProgress({ market: view, ledger: ledger ?? 0, events: [] }).detail}
            </p>
            {view.status === "Open" && closeDate !== null && (
              <p className="mt-3 border-t border-line pt-3 text-[12px] text-ink-3">
                Closes in <span className="numeric text-ink-2">{formatCountdown(countdown(closeDate, now))}</span>
              </p>
            )}
          </div>

          {needsProceeds && (
            <div className="mt-4 flex items-start gap-2 border-l-2 border-accent/60 pl-3 text-[12px] leading-relaxed text-ink-3">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
              <p>
                The amounts received are decrypted with the company account's key, in this browser. The contract does
                not expose them publicly.
              </p>
            </div>
          )}
        </aside>
      </div>

      <ManageDialog
        action={pending}
        onClose={() => setPending(null)}
        market={view}
        cmiReady={cmi !== null}
        onDone={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["market"] }),
            queryClient.invalidateQueries({ queryKey: ["markets"] }),
          ]);
        }}
      />
    </div>
  );
}

function SellerQuotaBalance({ quotaAsset, seller }: { quotaAsset: string; seller: string }) {
  const { chain } = useNetwork();
  const balance = useQuery({
    queryKey: ["sac-balance", quotaAsset, seller],
    queryFn: () => readSacBalance(chain, quotaAsset, seller),
    retry: 1,
  });
  if (balance.isPending) return <p className="text-[12px] text-ink-3">Reading the company's asset balance…</p>;
  if (balance.isError) return <p className="text-[12px] text-ink-3">Company asset balance unavailable.</p>;
  return (
    <p className="text-[12.5px] text-ink-3">
      Company balance in this asset: <span className="numeric text-ink-2">{formatXlm(balance.data)} units</span>. The
      auction locks the offered quotas when it opens.
    </p>
  );
}

function ProceedsSection({ market }: { market: MarketView }) {
  const cmi = useCmi();
  const { address } = useWallet();
  const proceeds = useQuery({
    queryKey: ["proceeds", address, market.marketId.toString()],
    enabled: cmi !== null && address !== null && (market.status === "Settled" || market.status === "Finalized"),
    retry: 1,
    queryFn: async () => {
      if (cmi === null) throw new Error("wallet not connected");
      await cmi.client.account.sync();
      return cmi.client.seller.proceeds(market.marketId);
    },
  });

  if (proceeds.isPending) {
    return (
      <Section title="Proceeds" id="proceeds">
        <LoadingRows rows={2} />
      </Section>
    );
  }
  if (proceeds.isError) {
    return (
      <Section title="Proceeds" id="proceeds">
        <ErrorNotice error={proceeds.error} onRetry={() => void proceeds.refetch()} />
      </Section>
    );
  }

  const rows = proceeds.data;
  const known = rows.reduce((total, row) => total + (row.received ?? 0n), 0n);
  const missing = rows.filter((row) => row.received === null).length;

  return (
    <Section
      title="Proceeds"
      id="proceeds"
      aside={<span className="numeric text-[12px] text-ink-3">{rows.length} {rows.length === 1 ? "paid bid" : "paid bids"}</span>}
    >
      {rows.length === 0 ? (
        <p className="border-y border-line py-6 text-[13px] text-ink-2">
          No payment settled yet. The operator settles one bid per ledger.
        </p>
      ) : (
        <>
          <div className="flex items-baseline justify-between border-y border-line py-3">
            <span className="text-sm text-ink-2">Total known proceeds</span>
            <span className="numeric text-lg font-semibold">{formatXlmWithUnit(known)}</span>
          </div>
          <ul className="divide-y divide-line border-b border-line">
            {rows.map((row) => (
              <li key={row.bidIndex} className="flex items-center justify-between gap-4 py-2.5 text-[13px]">
                <span className="text-ink-2">
                  Bid #{row.bidIndex} · {formatQuotas(row.filled)}
                </span>
                <span className={row.received === null ? "text-right text-[12px] text-ink-3" : "numeric text-right font-medium"}>
                  {row.received === null ? "outside the RPC history" : formatXlmWithUnit(row.received)}
                </span>
              </li>
            ))}
          </ul>
          {missing > 0 && (
            <InlineNote>
              {missing === 1 ? "One old payment is" : `${missing} old payments are`} outside the RPC window (~7 days).
              The value is unknown, not zero.
            </InlineNote>
          )}
        </>
      )}
    </Section>
  );
}

function EventsList({ market }: { market: MarketView }) {
  const events = useMarketEvents(market.marketId, market.address, market.status);
  if (events.error !== null) return <ErrorNotice error={events.error} />;
  if (events.events === null) return <LoadingRows rows={2} />;
  if (events.events.length === 0) return <p className="border-y border-line py-6 text-[13px] text-ink-3">No public events yet.</p>;
  return <MarketTimeline events={events.events} />;
}

function ManageDialog({
  action,
  onClose,
  market,
  cmiReady,
  onDone,
}: {
  action: ManagementAction | null;
  onClose: () => void;
  market: MarketView;
  cmiReady: boolean;
  onDone: () => Promise<void>;
}) {
  const cmi = useCmi();
  const run = useMutation({
    mutationFn: async (kind: ManagementAction) => {
      if (cmi === null) throw new Error("wallet not connected");
      switch (kind) {
        case "open":
          return cmi.client.seller.openMarket(market.marketId);
        case "cancel":
          return cmi.client.seller.cancelMarket(market.marketId);
        case "close":
          return cmi.client.auctionAt(market.address).closeMarket(cmi.signer);
        case "cancel-expired":
          return cmi.client.auctionAt(market.address).cancelExpired(cmi.signer);
      }
    },
    onSuccess: async () => {
      await onDone();
      toast.success("Transaction confirmed.");
      onClose();
    },
  });

  if (action === null) return null;
  const copy = ACTION_COPY[action];

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!run.isPending}
      title={copy.title}
      description={copy.description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={run.isPending}>
            Back
          </Button>
          <Button
            variant={copy.danger ? "danger" : "primary"}
            loading={run.isPending}
            disabled={!cmiReady}
            onClick={() => run.mutate(action)}
          >
            {copy.confirm}
          </Button>
        </>
      }
    >
      <InlineNote>Your wallet opens to sign. The platform fee does not change in this action.</InlineNote>
      {run.error !== null && <ErrorNotice error={run.error} className="mt-4" />}
      {run.error !== null && errorTextFrom(run.error).recovery !== undefined && (
        <p className="mt-2 text-[12.5px] text-ink-3">The action shown above resolves the blocker before you try again.</p>
      )}
    </Dialog>
  );
}

function BackLink() {
  return (
    <Link to="/company" className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:text-ink">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      Company
    </Link>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-2xl py-16">
      <EmptyState title="Auction not found" detail="The identifier in the URL does not exist on this network." action={<ButtonLink to="/company">Back</ButtonLink>} />
    </div>
  );
}
