import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PreparedBid } from "@zolvency-cmi/client";
import { ArrowLeft, Check, Circle, LockKeyhole, ShieldAlert, ShieldCheck } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { useConfig } from "@/config/ConfigProvider";
import { formatQuotas, formatXlm, formatXlmWithUnit, parseQuotas, parseXlm } from "@/domain/amount";
import { errorTextFrom } from "@/domain/errors";
import { statusLabel } from "@/domain/market";
import { countdown, formatCountdown, ledgerToDate } from "@/domain/time";
import { cn } from "@/lib/cn";
import { useAccountStatus, useCmi } from "@/sdk/CmiProvider";
import { useNetwork, useNow } from "@/sdk/NetworkProvider";
import { hasQuotaTrustline, readSacName } from "@/sdk/quota";
import { useMarketId } from "@/sdk/useMarketId";
import { useMarket } from "@/sdk/useMarkets";
import { useBalance, useSyncAccount } from "@/sdk/useAccount";
import { Button, ButtonLink } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { EmptyState, ErrorNotice, LoadingRows } from "@/ui/Feedback";
import { Field, Input } from "@/ui/Field";
import { DefinitionList, DefinitionRow, InlineNote, PageHeader, Section } from "@/ui/Layout";
import { useWallet } from "@/wallet/WalletProvider";
import { addTrustline } from "@/wallet/classic";

export function BidPage() {
  const id = useMarketId();
  const market = useMarket(id);
  const { address, mode, setMode, adapter } = useWallet();
  const { chain, ledger, anchor } = useNetwork();
  const config = useConfig();
  const cmi = useCmi();
  const status = useAccountStatus();
  const balance = useBalance();
  const sync = useSyncAccount();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const now = useNow();

  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [prepared, setPrepared] = useState<PreparedBid | null>(null);
  const [confirmation, setConfirmation] = useState<{ price: bigint; count: number; total: bigint } | null>(null);
  const [placed, setPlaced] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const quotaAsset = market.data?.quotaAsset;
  const trustline = useQuery({
    queryKey: ["trustline", address, quotaAsset],
    enabled: address !== null && quotaAsset !== undefined,
    retry: 1,
    queryFn: () => {
      if (address === null || quotaAsset === undefined) throw new Error("no wallet");
      return hasQuotaTrustline(chain, quotaAsset, address);
    },
  });

  const enableTrustline = useMutation({
    mutationFn: async () => {
      if (adapter === null || quotaAsset === undefined) throw new Error("no wallet");
      const asset = await readSacName(chain, quotaAsset);
      await addTrustline(adapter, asset, config.horizonUrl, config.passphrase);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["trustline"] });
      toast.success("Quota enabled in the wallet.");
    },
  });

  const prepare = useMutation({
    mutationFn: async ({ priceValue, count }: { priceValue: bigint; count: number }) => {
      if (cmi === null || id === null) throw new Error("wallet not connected");

      await cmi.client.account.sync();
      return cmi.client.bidder.prepareBid(id, priceValue, count);
    },
    onSuccess: (value, variables) => {
      setPrepared(value);
      setConfirmation({
        price: variables.priceValue,
        count: variables.count,
        total: variables.priceValue * BigInt(variables.count),
      });
    },
  });

  const place = useMutation({
    mutationFn: async (value: PreparedBid) => {
      if (cmi === null) throw new Error("wallet not connected");
      return cmi.client.bidder.placeBid(value);
    },
    onSuccess: async (result) => {
      setPrepared(null);
      setConfirmation(null);
      setPrice("");
      setQuantity("");
      setPlaced(result.bidIndex);
      toast.success(`Bid #${result.bidIndex} accepted.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["market"] }),
        queryClient.invalidateQueries({ queryKey: ["markets"] }),
        queryClient.invalidateQueries({ queryKey: ["my-bid"] }),
        queryClient.invalidateQueries({ queryKey: ["account"] }),
      ]);
    },
  });

  const recover = useMutation({
    mutationFn: async () => {
      if (cmi === null || id === null) throw new Error("wallet not connected");
      await cmi.client.account.sync();
      return cmi.client.bidder.recoverCollateral(id);
    },
    onSuccess: async () => {
      toast.success("Collateral returned to the spendable balance.");
      await queryClient.invalidateQueries({ queryKey: ["account"] });
    },
  });

  const parsed = useMemo(() => {
    let priceValue: bigint | null = null;
    let count: number | null = null;
    try {
      const value = parseXlm(price);
      if (value > 0n) priceValue = value;
    } catch {
      priceValue = null;
    }
    try {
      count = parseQuotas(quantity);
    } catch {
      count = null;
    }
    const total = priceValue !== null && count !== null ? priceValue * BigInt(count) : null;
    return { priceValue, count, total };
  }, [price, quantity]);

  if (id === null) {
    return (
      <div className="mx-auto max-w-2xl py-16">
        <p className="text-base font-semibold">Auction not found</p>
        <p className="mt-1 text-sm text-ink-2">The identifier in the URL does not exist on this network.</p>
        <ButtonLink to="/" className="mt-5">
          View auctions
        </ButtonLink>
      </div>
    );
  }

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

  if (market.data === null) return <NotFoundMarket />;

  const view = market.data;
  const closeDate = anchor === null ? null : ledgerToDate(view.closeLedger, anchor);
  const open = view.status === "Open" && (ledger === null || ledger < view.closeLedger);
  const accountReady = status.data !== undefined && status.data.onChain && status.data.hasKey;
  const spendable = balance.data?.spendable ?? null;
  const enough = spendable !== null && parsed.total !== null ? spendable >= parsed.total : null;
  const belowFloor = parsed.priceValue !== null && parsed.priceValue < view.minPricePerQuota;
  const checklistDone = address !== null && accountReady && trustline.data === true && open && mode === "investor";
  const canPrepare =
    checklistDone && parsed.priceValue !== null && parsed.count !== null && belowFloor === false && enough !== false && cmi !== null;
  const prepareError = prepare.error;
  const placeError = place.error;

  const submit = (): void => {
    setFormError(null);
    if (address === null) {
      setFormError("Connect your wallet before preparing the bid.");
      return;
    }
    if (mode !== "investor") {
      setFormError("Switch to Investor mode to place a bid.");
      return;
    }
    if (parsed.priceValue === null) {
      setFormError("Enter a price per quota greater than zero, with up to 7 decimal places.");
      return;
    }
    if (parsed.count === null) {
      setFormError("Enter a whole number of quotas greater than zero.");
      return;
    }
    if (belowFloor) {
      setFormError(`The price is below the public floor of ${formatXlm(view.minPricePerQuota)} XLM per quota.`);
      return;
    }
    if (trustline.data !== true) {
      setFormError("Enable the quota asset in your wallet before preparing.");
      return;
    }
    if (enough === false) {
      setFormError("The spendable confidential balance does not cover price × quantity.");
      return;
    }
    prepare.mutate({ priceValue: parsed.priceValue, count: parsed.count });
  };

  if (placed !== null) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <div className="rounded-sheet border border-line bg-surface p-7">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-success/[0.1] text-success">
            <Check className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">Bid #{placed} sent</h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-2">
            The contract received the commitment and locked the collateral. The price stays sealed until the operator
            finalizes. Nothing else to do in this auction.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <ButtonLink to={`/market/${view.marketId}`}>Follow auction</ButtonLink>
            <ButtonLink to="/investor" variant="secondary">
              My bids
            </ButtonLink>
          </div>
        </div>
        <p className="mt-4 text-[12px] text-ink-3">
          The price and quantity were discarded from this tab after submission.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <BackLink marketId={view.marketId.toString()} />
      <PageHeader
        eyebrow={`Auction #${view.marketId.toString()}`}
        title="Prepare bid"
        description={
          <>
            Public floor of <span className="numeric font-medium text-ink">{formatXlm(view.minPricePerQuota)} XLM</span> per
            quota. The price you type stays only in this tab's memory.
          </>
        }
        className="mt-4"
      />

      <div className="mb-6 grid gap-x-8 gap-y-2 border-y border-line py-3 text-[13px] sm:grid-cols-3">
        <p>
          <span className="text-ink-3">Quotas offered </span>
          <span className="numeric font-medium">{formatQuotas(view.totalQuotas)}</span>
        </p>
        <p>
          <span className="text-ink-3">Status </span>
          <span className="font-medium">{statusLabel(view.status)}</span>
        </p>
        <p>
          <span className="text-ink-3">Close </span>
          <span className="numeric font-medium">
            {open
              ? closeDate === null
                ? `ledger ${view.closeLedger.toLocaleString("en-US")}`
                : formatCountdown(countdown(closeDate, now))
              : "closed to bids"}
          </span>
        </p>
      </div>

      {!open && (
        <div className="mb-6 border-l-2 border-warning bg-warning/[0.05] px-4 py-3 text-[13px] text-ink-2">
          This auction is no longer accepting bids. You can follow the finalization on the{" "}
          <Link to={`/market/${view.marketId}`} className="font-semibold text-primary">
            auction page
          </Link>
          .
        </div>
      )}

      {open && mode !== "investor" && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-l-2 border-primary bg-primary-soft/60 px-4 py-3">
          <p className="text-[13px] text-ink-2">To place a bid, the session must be in Investor mode.</p>
          <button type="button" onClick={() => setMode("investor")} className="text-[13px] font-semibold text-primary">
            Switch to Investor
          </button>
        </div>
      )}

      <Section title="Before you start" id="checklist">
        <ul className="divide-y divide-line border-y border-line">
          <ChecklistItem
            label="Wallet connected"
            detail={address === null ? "Connect Freighter on Testnet." : undefined}
            done={address !== null}
            action={
              address === null ? (
                <ButtonLink to="/wallet" size="sm" variant="secondary">
                  Connect
                </ButtonLink>
              ) : undefined
            }
          />
          <ChecklistItem
            label="Confidential account ready"
            detail={accountReady ? undefined : "The account holds the balance and openings in this browser."}
            done={accountReady}
            action={
              accountReady ? undefined : (
                <ButtonLink to="/wallet" size="sm" variant="secondary">
                  Resolve
                </ButtonLink>
              )
            }
          />
          <ChecklistItem
            label="Quota enabled in the wallet"
            detail={
              trustline.isError
                ? "The asset trustline could not be checked."
                : trustline.data === false
                  ? "Without the trustline, the contract rejects the bid before allocating."
                  : undefined
            }
            done={trustline.data === true}
            action={
              trustline.data === false && quotaAsset !== undefined ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={enableTrustline.isPending}
                  onClick={() => enableTrustline.mutate()}
                >
                  Enable
                </Button>
              ) : undefined
            }
          />
          <ChecklistItem
            label="Confidential balance"
            detail={
              spendable === null
                ? "The balance is read after the account is prepared."
                : `Spendable: ${formatXlmWithUnit(spendable)}. The bid locks price × quantity.`
            }
            done={spendable !== null && spendable > 0n}
            action={
              (spendable === null || spendable === 0n) && accountReady ? (
                <ButtonLink to="/wallet" size="sm" variant="secondary">
                  Deposit
                </ButtonLink>
              ) : undefined
            }
          />
        </ul>
        {balance.isError && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <ErrorNotice error={balance.error} className="flex-1" />
            <Button size="sm" variant="secondary" loading={sync.isPending} onClick={() => sync.mutate()}>
              Sync
            </Button>
          </div>
        )}
        {sync.isError && <ErrorNotice error={sync.error} className="mt-3" />}
        {enableTrustline.isError && <ErrorNotice error={enableTrustline.error} className="mt-3" />}
        <InlineNote>
          Preparation registers your wallet in the auction and generates two proofs in the browser — the first may take
          about half a minute. Nothing is locked until you confirm and sign.
        </InlineNote>
      </Section>

      <Section title="Your bid" id="bid">
        <div className="rounded-sheet border border-line bg-surface p-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              id="bid-price"
              label="Price per quota"
              hint="Stays sealed; the floor is public."
              error={belowFloor ? `Below the floor of ${formatXlm(view.minPricePerQuota)} XLM.` : undefined}
            >
              <Input
                id="bid-price"
                inputMode="decimal"
                autoComplete="off"
                value={price}
                onChange={(event) => {
                  setPrice(event.target.value);
                  setFormError(null);
                }}
                placeholder={formatXlm(view.minPricePerQuota)}
                suffix="XLM"
                invalid={belowFloor}
              />
            </Field>
            <Field id="bid-quantity" label="Quota quantity" hint={`The auction has ${formatQuotas(view.totalQuotas)}.`}>
              <Input
                id="bid-quantity"
                inputMode="numeric"
                autoComplete="off"
                value={quantity}
                onChange={(event) => {
                  setQuantity(event.target.value);
                  setFormError(null);
                }}
                placeholder="10"
                suffix="quotas"
              />
            </Field>
          </div>

          <div className="mt-4 border-t border-line pt-4">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm text-ink-2">Amount to lock (price × quantity)</span>
              <span className="numeric text-lg font-semibold">
                {parsed.total === null ? "—" : formatXlmWithUnit(parsed.total)}
              </span>
            </div>
            {enough === false && <p className="mt-1.5 text-[13px] text-danger">The spendable balance does not cover this amount.</p>}
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">
              The amount above appears only on this screen; it is not sent to the contract or stored in the browser.
            </p>
          </div>

          {formError !== null && <p role="alert" className="mt-3 text-[13px] text-danger">{formError}</p>}
          {prepareError !== null && <ErrorNotice error={prepareError} className="mt-4" />}
          {(prepareError !== null && errorTextFrom(prepareError).recovery?.kind === "revoke_spender") || recover.isError ? (
            <div className="mt-3">
              <Button variant="secondary" size="sm" loading={recover.isPending} onClick={() => recover.mutate()}>
                Recover locked collateral
              </Button>
              {recover.isError && <ErrorNotice error={recover.error} className="mt-3" />}
              {recover.isSuccess && <p className="mt-2 text-[13px] text-success">Collateral returned to the balance.</p>}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
              <LockKeyhole className="h-3.5 w-3.5 text-accent" aria-hidden />
              One bid per wallet.
            </p>
            <Button onClick={submit} loading={prepare.isPending} disabled={!canPrepare && !prepare.isPending}>
              {prepare.isPending ? "Generating proofs…" : "Prepare bid"}
            </Button>
          </div>
          {prepare.isPending && (
            <div className="mt-3 flex items-start gap-2 border-l-2 border-accent/60 pl-3 text-[12.5px] leading-relaxed text-ink-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
              <p>
                Proving bid validity and collateral delegation in this browser. Keep the tab open; nothing has been
                sent yet.
              </p>
            </div>
          )}
        </div>
      </Section>

      <Dialog
        open={prepared !== null}
        onClose={() => {
          if (!place.isPending) {
            setPrepared(null);
            setConfirmation(null);
            place.reset();
          }
        }}
        dismissible={!place.isPending}
        title="Confirm bid"
        description="Check the summary. The wallet signs two transactions: collateral lock and bid submission."
        footer={
          <>
            <Button
              variant="ghost"
              disabled={place.isPending}
              onClick={() => {
                setPrepared(null);
                setConfirmation(null);
                place.reset();
              }}
            >
              Back and review
            </Button>
            <Button
              loading={place.isPending}
              onClick={() => {
                if (prepared !== null) place.mutate(prepared);
              }}
            >
              {place.isPending ? "Sending…" : "Sign and send"}
            </Button>
          </>
        }
      >
        {prepared !== null && confirmation !== null && (
          <div className="space-y-4">
            <DefinitionList>
              <DefinitionRow term="Quantity">{formatQuotas(confirmation.count)}</DefinitionRow>
              <DefinitionRow term="Price per quota">{formatXlmWithUnit(confirmation.price)}</DefinitionRow>
              <DefinitionRow term="Amount to lock">{formatXlmWithUnit(confirmation.total)}</DefinitionRow>
              <DefinitionRow term="Auction">#{view.marketId.toString()}</DefinitionRow>
            </DefinitionList>
            {prepared.warnings.includes("DepositRevealsPrice") && (
              <div className="flex items-start gap-2 border-l-2 border-warning bg-warning/[0.05] px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-2">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                <p>
                  Your latest deposit has exactly the amount of this bid. Since deposits are public, this can reveal the
                  price. Deposit a different amount before sending if you want to avoid that clue.
                </p>
              </div>
            )}
            <p className="text-[12px] leading-relaxed text-ink-3">
              After you confirm, the price is discarded from this tab. The contract keeps only the commitment.
            </p>
            {placeError !== null && <ErrorNotice error={placeError} />}
            {placeError !== null && errorTextFrom(placeError).recovery?.kind === "revoke_spender" && (
              <Button
                variant="secondary"
                size="sm"
                loading={recover.isPending}
                onClick={() => recover.mutate()}
              >
                Recover locked collateral
              </Button>
            )}
            {recover.isError && <ErrorNotice error={recover.error} />}
          </div>
        )}
      </Dialog>

      {address === null && (
        <p className="mt-4 text-[12.5px] text-ink-3">
          Connect your wallet to check balance, trustline and send the bid.{" "}
          <Link to="/wallet" className="font-semibold text-primary">
            Open wallet
          </Link>
        </p>
      )}
      <div className="mt-8 flex justify-between text-[12px] text-ink-3">
        <button type="button" onClick={() => navigate(-1)} className="hover:text-ink">
          Back
        </button>
        <span className="numeric">balance checked at ledger {ledger?.toLocaleString("en-US") ?? "—"}</span>
      </div>
    </div>
  );
}

function ChecklistItem({
  label,
  detail,
  done,
  action,
}: {
  label: string;
  detail?: string | undefined;
  done: boolean;
  action?: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span
        className={cn(
          "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border",
          done ? "border-success bg-success text-white" : "border-line-strong text-ink-3",
        )}
        aria-hidden
      >
        {done ? <Check className="h-3 w-3" /> : <Circle className="h-2 w-2 fill-current opacity-40" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("text-[13.5px] font-medium", !done && "text-ink-2")}>{label}</p>
        {detail !== undefined && <p className="mt-0.5 text-[12.5px] text-ink-3">{detail}</p>}
      </div>
      {action}
    </li>
  );
}

function NotFoundMarket() {
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

function BackLink({ marketId }: { marketId?: string }) {
  return (
    <Link
      to={marketId === undefined ? "/" : `/market/${marketId}`}
      className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:text-ink"
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
      {marketId === undefined ? "Auctions" : "Back to auction"}
    </Link>
  );
}
