import { useQuery } from "@tanstack/react-query";
import { Check, Circle, Plus } from "lucide-react";
import { Link } from "react-router-dom";

import { MarketRow } from "@/components/MarketRow";
import { useConfig } from "@/config/ConfigProvider";
import { formatXlm } from "@/domain/amount";
import { statusLabel } from "@/domain/market";
import { cn } from "@/lib/cn";
import { useAccountStatus } from "@/sdk/CmiProvider";
import { useNow, useNetwork } from "@/sdk/NetworkProvider";
import { useMarkets } from "@/sdk/useMarkets";
import { ButtonLink } from "@/ui/Button";
import { EmptyState, ErrorNotice, LoadingRows } from "@/ui/Feedback";
import { PageHeader, Section } from "@/ui/Layout";
import { useWallet } from "@/wallet/WalletProvider";
import { fetchPublicAccount } from "@/wallet/public";

const RESERVE = 5_000_000n;

export function CompanyPage() {
  const { address, mode, setMode } = useWallet();
  const config = useConfig();
  const { ledger, anchor } = useNetwork();
  const now = useNow();
  const status = useAccountStatus();
  const markets = useMarkets();
  const publicAccount = useQuery({
    queryKey: ["public-account", address],
    queryFn: () => fetchPublicAccount(address ?? "", config),
    enabled: address !== null,
  });

  if (address === null) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow="Company"
          title="Sell quotas at auction"
          description="The company locks the quotas in the contract, sets quantity and floor, and is paid by settlement. Each bid price stays sealed."
        />
        <div className="border-y border-line py-10 text-center">
          <p className="text-sm text-ink-2">Connect the company wallet to get started.</p>
          <ButtonLink to="/wallet" className="mt-4">
            Connect wallet
          </ButtonLink>
        </div>
      </div>
    );
  }

  const checks = [
    {
      label: "Confidential account registered",
      detail: "Required to receive payments from winners.",
      done: status.data?.onChain === true && status.data.hasKey,
      to: "/wallet",
    },
    {
      label: "Key backup",
      detail: "Without it, proceeds cannot be reopened in another browser.",
      done: status.data !== undefined && status.data.hasKey && !status.data.backupRequired,
      to: "/wallet#backup",
    },
    {
      label: "XLM for fees and reserves",
      detail: `At least ${formatXlm(RESERVE)} XLM public for network fees.`,
      done: (publicAccount.data?.xlm ?? 0n) >= RESERVE,
      to: "/wallet",
    },
  ];

  const mine = (markets.data ?? []).filter((market) => market.seller === address);
  const ready = checks.every((check) => check.done);

  return (
    <div>
      <PageHeader
        eyebrow="Company"
        title="Company auctions"
        description="Quantity and floor are public; bids are not. Unsold quotas return to the company wallet."
        actions={
          <ButtonLink to="/company/new" icon={<Plus className="h-4 w-4" aria-hidden />} className={cn(!ready && "pointer-events-none opacity-50")}>
            Create auction
          </ButtonLink>
        }
      />

      {mode !== "company" && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-l-2 border-primary bg-primary-soft/60 px-4 py-3">
          <p className="text-[13px] text-ink-2">You are in Investor mode.</p>
          <button type="button" onClick={() => setMode("company")} className="text-[13px] font-semibold text-primary">
            Switch to Company mode
          </button>
        </div>
      )}

      <Section title="Prerequisites" id="prerequisites">
        <ul className="divide-y divide-line border-y border-line">
          {checks.map((check) => (
            <li key={check.label} className="flex items-start gap-3 py-3.5">
              <span
                className={cn(
                  "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border",
                  check.done ? "border-success bg-success text-white" : "border-line-strong text-ink-3",
                )}
                aria-hidden
              >
                {check.done ? <Check className="h-3 w-3" /> : <Circle className="h-2 w-2 fill-current opacity-40" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium">{check.label}</p>
                <p className="mt-0.5 text-[12.5px] text-ink-3">{check.detail}</p>
              </div>
              {!check.done && (
                <Link to={check.to} className="text-[12.5px] font-semibold text-primary">
                  Resolve
                </Link>
              )}
            </li>
          ))}
        </ul>
        {status.isError && <ErrorNotice error={status.error} className="mt-4" />}
      </Section>

      <Section
        title="My auctions"
        id="my-auctions"
        aside={
          mine.length > 0 ? (
            <span className="text-[12px] text-ink-3">
              {mine.filter((market) => market.status === "Open").length} open of {mine.length}
            </span>
          ) : undefined
        }
      >
        {markets.isPending ? (
          <LoadingRows rows={2} />
        ) : markets.isError ? (
          <ErrorNotice error={markets.error} onRetry={() => void markets.refetch()} />
        ) : mine.length === 0 ? (
          <EmptyState
            title="No company auctions"
            detail="Create the first auction with the asset of the quotas the company already issues."
            action={
              <ButtonLink to="/company/new" icon={<Plus className="h-4 w-4" aria-hidden />}>
                Create auction
              </ButtonLink>
            }
            mono="seller has no markets"
          />
        ) : (
          <div className="rule-list">
            {mine
              .sort((a, b) => Number(b.marketId - a.marketId))
              .map((market) => (
                <div key={market.marketId.toString()}>
                  <MarketRow market={market} ledger={ledger} anchor={anchor} now={now} />
                  <p className="pb-2 text-[12px] text-ink-3">
                    {statusLabel(market.status)} ·{" "}
                    <Link to={`/company/market/${market.marketId}`} className="font-medium text-ink-2 underline-offset-2 hover:underline">
                      manage
                    </Link>
                  </p>
                </div>
              ))}
          </div>
        )}
      </Section>
    </div>
  );
}
