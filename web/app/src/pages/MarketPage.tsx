import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { DemandBar } from "@/components/DemandBar";
import { CloseLabel } from "@/components/MarketRow";
import { MarketTimeline } from "@/components/MarketTimeline";
import { formatQuotas, formatXlm } from "@/domain/amount";
import { actionsFor, operatorProgress, statusLabel, statusTone, type MarketAction } from "@/domain/market";
import { relativeToLedger } from "@/domain/time";
import { useNow, useNetwork } from "@/sdk/NetworkProvider";
import { useCmi } from "@/sdk/CmiProvider";
import { useMarketId } from "@/sdk/useMarketId";
import { useMarket, useMarketEvents } from "@/sdk/useMarkets";
import { Address } from "@/ui/Address";
import { Badge } from "@/ui/Badge";
import { Button, ButtonLink } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { EmptyState, ErrorNotice, LoadingRows } from "@/ui/Feedback";
import { DefinitionList, DefinitionRow, InlineNote, Section } from "@/ui/Layout";
import { useWallet } from "@/wallet/WalletProvider";

export function MarketPage() {
  const id = useMarketId();
  const market = useMarket(id);
  const { ledger, anchor, config } = useNetwork();
  const now = useNow();
  const { address, mode } = useWallet();
  const cmi = useCmi();
  const events = useMarketEvents(id, market.data?.address ?? null, market.data?.status);
  const [pending, setPending] = useState<MarketAction | null>(null);

  if (id === null) return <NotFound />;
  if (market.isPending) {
    return (
      <div className="mx-auto max-w-4xl">
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
  const actions = actionsFor({ market: view, mode, me: address, ledger: ledger ?? 0 });
  const progress = operatorProgress({ market: view, ledger: ledger ?? 0, events: events.events ?? [] });
  const closeIn = relativeToLedger(view.closeLedger, ledger, anchor);
  const finalizeIn = view.finalizeByLedger === null ? null : relativeToLedger(view.finalizeByLedger, ledger, anchor);

  return (
    <div className="mx-auto max-w-5xl">
      <BackLink />
      <header className="mt-5 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Badge tone={statusTone(view.status)}>{statusLabel(view.status)}</Badge>
            <span className="numeric text-[12px] text-ink-3">auction #{view.marketId.toString()}</span>
          </div>
          <h1 className="mt-2.5 text-[28px] font-semibold tracking-[-0.02em] sm:text-[34px]">
            {formatQuotas(view.totalQuotas)} at auction
          </h1>
          <p className="mt-1.5 text-sm text-ink-2">
            Public floor of <span className="numeric font-medium text-ink">{formatXlm(view.minPricePerQuota)} XLM</span> per quota.
            Sealed bid prices.
          </p>
        </div>
        <div className="text-right text-[13px] text-ink-3">
          <p className="relative -top-0.5">
            <CloseLabel market={view} ledger={ledger} anchor={anchor} now={now} />
          </p>
          {closeIn !== null && <p className="mt-1 text-[12px] text-ink-3">Close {closeIn} (estimated)</p>}
        </div>
      </header>

      <div className="grid gap-10 py-7 lg:grid-cols-[minmax(0,1fr)_348px]">
        <div className="min-w-0">
          <section aria-label="Public parameters">
            <DefinitionList>
              <DefinitionRow term="Quotas offered">{formatQuotas(view.totalQuotas)}</DefinitionRow>
              <DefinitionRow term="Floor per quota" hint="Public, set by the seller">
                {formatXlm(view.minPricePerQuota)} XLM
              </DefinitionRow>
              <DefinitionRow term="Bids accepted">{view.bidCount}</DefinitionRow>
              <DefinitionRow term="Public demand" hint="Sum of requested quantities; no price">
                {formatQuotas(view.demand)}
              </DefinitionRow>
              <DefinitionRow term="Close" hint={closeIn === null ? "estimated from the ledger" : `${closeIn} (estimated)`}>
                ledger {view.closeLedger.toLocaleString("en-US")}
              </DefinitionRow>
              {view.finalizeByLedger !== null && (
                <DefinitionRow
                  term="Finalization by"
                  hint={finalizeIn === null ? undefined : `${finalizeIn} (estimated)`}
                >
                  ledger {view.finalizeByLedger.toLocaleString("en-US")}
                </DefinitionRow>
              )}
              <DefinitionRow term="Seller">
                <Address value={view.seller} size={5} copy />
              </DefinitionRow>
              <DefinitionRow term="Auction address">
                <Address value={view.address} size={5} copy explorer />
              </DefinitionRow>
              <DefinitionRow term="Quota asset">
                <Address value={view.quotaAsset} size={5} copy explorer />
              </DefinitionRow>
            </DefinitionList>
            <div className="mt-4">
              <DemandBar demand={view.demand} totalQuotas={view.totalQuotas} />
              <p className="mt-2 text-[12px] text-ink-3">
                Demand is public and does not reveal price. Allocation appears only after the operator finalizes.
              </p>
            </div>
          </section>

          {view.allocation !== null && (
            <Section title="Allocation" id="allocation">
              <div className="border-y border-line">
                {view.allocation.map((filled, index) => (
                  <div key={index} className="flex items-center justify-between gap-4 border-b border-line py-2.5 text-[13px] last:border-b-0">
                    <span className="text-ink-2">Bid #{index}</span>
                    <span className={filled === 0 ? "text-ink-3" : "numeric font-medium"}>
                      {filled === 0 ? "no allocation" : formatQuotas(filled)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[12px] text-ink-3">
                Allocation is public. Prices and amounts paid remain confidential.
              </p>
            </Section>
          )}

          <Section title="Public history" id="history">
            {events.error !== null ? (
              <ErrorNotice error={events.error} />
            ) : events.events === null ? (
              <LoadingRows rows={3} />
            ) : (
              <MarketTimeline events={events.events} />
            )}
          </Section>
        </div>

        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-sheet border border-line bg-surface p-5">
            <p className="label">Next action</p>
            {actions.length === 0 ? (
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
                {address === null
                  ? "Connect your wallet to participate or run open actions."
                  : view.status === "Open"
                    ? "Nothing to do in this auction right now. Follow the close."
                    : "No action available to this wallet in this state."}
              </p>
            ) : (
              <div className="mt-2.5 flex flex-col gap-2">
                {actions.map((action) =>
                  action.to !== undefined ? (
                    <ButtonLink key={action.kind} to={action.to} variant={action.tone}>
                      {action.label}
                    </ButtonLink>
                  ) : (
                    <Button
                      key={action.kind}
                      variant={action.tone}
                      onClick={() => setPending(action)}
                      disabled={cmi === null}
                    >
                      {action.label}
                    </Button>
                  ),
                )}
              </div>
            )}
            {address === null && (
              <Link to="/wallet" className="mt-3 inline-block text-[13px] font-semibold text-primary underline-offset-2 hover:underline">
                Connect wallet
              </Link>
            )}
            {mode === "company" && address !== null && view.status === "Open" && (
              <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
                You are in Company mode. To place a bid, switch to Investor in the sidebar.
              </p>
            )}
          </div>

          <div className="mt-4 rounded-sheet border border-line p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="label">Operator</p>
              <span className={`h-1.5 w-1.5 rounded-full ${progress.tone === "danger" ? "bg-danger" : progress.tone === "success" ? "bg-success" : progress.tone === "live" ? "bg-accent" : "bg-primary"}`} aria-hidden />
            </div>
            <p className="mt-2 text-sm font-semibold">{progress.title}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{progress.detail}</p>
            {config.finalizationGraceLedgers > 0 && (
              <p className="mt-3 border-t border-line pt-3 text-[11.5px] leading-relaxed text-ink-3">
                Finalization grace on this network: {config.finalizationGraceLedgers} ledgers
                {` (~${Math.round((config.finalizationGraceLedgers * config.secondsPerLedger) / 60)} min).`}
              </p>
            )}
          </div>

          <div className="mt-4 border-l-2 border-accent/60 pl-3.5">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
              <LockKeyhole className="h-3.5 w-3.5 text-accent" aria-hidden />
              Sealed price
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-3">
              The contract receives a commitment, not the price. Opening happens at finalization; the allocation proof is public.
            </p>
          </div>
        </aside>
      </div>

      <ActionDialog action={pending} onClose={() => setPending(null)} marketId={id} address={view.address} />
    </div>
  );
}

function ActionDialog({
  action,
  onClose,
  marketId,
  address,
}: {
  action: MarketAction | null;
  onClose: () => void;
  marketId: bigint;
  address: string;
}) {
  const cmi = useCmi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const run = useMutation({
    mutationFn: async (kind: MarketAction["kind"]) => {
      if (cmi === null) throw new Error("wallet not connected");
      const auction = cmi.client.auctionAt(address);
      switch (kind) {
        case "close":
          return auction.closeMarket(cmi.signer);
        case "cancel-expired":
          return auction.cancelExpired(cmi.signer);
        case "open":
          return auction.openMarket(cmi.signer);
        case "cancel":
          return auction.cancelMarket(cmi.signer);
        default:
          throw new Error("action without transaction");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["market"] });
      await queryClient.invalidateQueries({ queryKey: ["markets"] });
      toast.success("Transaction confirmed.");
      onClose();
    },
  });

  if (action === null) return null;
  const confirmText: Partial<Record<MarketAction["kind"], string>> = {
    close: "The auction closes to new bids. The operator then has the grace period to finalize allocation.",
    "cancel-expired": "The finalization deadline has passed. Cancellation returns quotas and collateral; nothing is settled.",
    open: "Your quotas stay locked in the contract until the auction ends or is cancelled.",
    cancel: "The auction is closed and the locked quotas return to you. Only possible before the first bid.",
    proceeds: "Open the auction proceeds.",
  };

  return (
    <Dialog
      open
      onClose={onClose}
      dismissible={!run.isPending}
      title={action.label}
      description={confirmText[action.kind]}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={run.isPending}>
            Cancel
          </Button>
          <Button
            variant={action.tone === "danger" ? "danger" : "primary"}
            loading={run.isPending}
            onClick={() =>
              run.mutate(action.kind, {
                onSuccess: () => {
                  if (action.kind === "proceeds") navigate(`/company/market/${marketId.toString()}`);
                },
              })
            }
          >
            {action.tone === "danger" ? "Confirm cancellation" : "Sign and send"}
          </Button>
        </>
      }
    >
      <InlineNote>Your wallet opens to sign. The operator fee does not change in this action.</InlineNote>
      {run.error !== null && <ErrorNotice error={run.error} className="mt-4" />}
    </Dialog>
  );
}

function BackLink() {
  return (
    <Link to="/" className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:text-ink">
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      Auctions
    </Link>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-2xl py-16">
      <EmptyState
        title="Auction not found"
        detail="The identifier in the URL does not exist on this network. Go back to the list and pick an auction."
        mono="404"
        action={<ButtonLink to="/">View auctions</ButtonLink>}
      />
    </div>
  );
}
