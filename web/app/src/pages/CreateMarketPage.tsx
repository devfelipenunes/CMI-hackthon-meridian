import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { useConfig } from "@/config/ConfigProvider";
import { formatQuotas, formatXlm, parseQuotas, parseXlm } from "@/domain/amount";
import { durationToLedgers, formatDuration, type DurationUnit } from "@/domain/time";
import { cn } from "@/lib/cn";
import { useCmi, useRegisterData } from "@/sdk/CmiProvider";
import { useNetwork } from "@/sdk/NetworkProvider";
import { hasQuotaTrustline, readSacBalance, readSacName } from "@/sdk/quota";
import { StaticRegisterDataProvider } from "@/sdk/register-data";
import { useAccountStatus } from "@/sdk/CmiProvider";
import { Button, ButtonLink } from "@/ui/Button";
import { ErrorNotice } from "@/ui/Feedback";
import { Field, Input } from "@/ui/Field";
import { InlineNote, PageHeader } from "@/ui/Layout";
import { useWallet } from "@/wallet/WalletProvider";
import { addTrustline, type SacAsset } from "@/wallet/classic";
import { checkMarketParams } from "@zolvency-cmi/client";
import { MAX_DURATION_LEDGERS, MIN_FEE_RESERVE, type MarketParams } from "@zolvency-cmi/core";

const STEPS = ["Asset", "Offer", "Deadline", "Review"] as const;

const DURATION_UNITS: readonly DurationUnit[] = ["minutes", "hours", "days"];

export function CreateMarketPage() {
  const { address, adapter } = useWallet();
  const { chain, ledger, anchor } = useNetwork();
  const config = useConfig();
  const cmi = useCmi();
  const registerData = useRegisterData();
  const status = useAccountStatus();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [assetInput, setAssetInput] = useState("");
  const [asset, setAsset] = useState<SacAsset | null>(null);
  const [assetBalance, setAssetBalance] = useState<bigint | null>(null);
  const [trustline, setTrustline] = useState<boolean | null>(null);
  const [reading, setReading] = useState(false);
  const [totalQuotas, setTotalQuotas] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [durationAmount, setDurationAmount] = useState("7");
  const [durationUnit, setDurationUnit] = useState<DurationUnit>("days");
  const [feeReserve, setFeeReserve] = useState("5");
  const [error, setError] = useState<unknown>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (address === null) {
    return (
      <div className="mx-auto max-w-2xl py-16">
        <p className="label">Company</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Create auction</h1>
        <p className="mt-2 text-sm text-ink-2">Connect the company wallet to configure the auction.</p>
        <ButtonLink to="/wallet" className="mt-5">
          Connect wallet
        </ButtonLink>
      </div>
    );
  }

  const readAsset = async (): Promise<void> => {
    setReading(true);
    setFieldError(null);
    setError(null);
    try {
      const [info, balance, hasTrustline] = await Promise.all([
        readSacName(chain, assetInput.trim()),
        readSacBalance(chain, assetInput.trim(), address).catch(() => null),
        hasQuotaTrustline(chain, assetInput.trim(), address),
      ]);
      setAsset(info);
      setAssetBalance(balance);
      setTrustline(hasTrustline);
    } catch (cause) {
      setAsset(null);
      setError(cause);
    } finally {
      setReading(false);
    }
  };

  const enableAsset = async (): Promise<void> => {
    if (asset === null || adapter === null) return;
    setError(null);
    try {
      await addTrustline(adapter, asset, config.horizonUrl, config.passphrase);
      setTrustline(true);
      toast.success("Asset enabled in the wallet.");
      queryClient.invalidateQueries({ queryKey: ["public-account"] });
    } catch (cause) {
      setError(cause);
    }
  };

  const parsedQuotas = (() => {
    try {
      return parseQuotas(totalQuotas);
    } catch {
      return null;
    }
  })();
  const parsedMin = (() => {
    try {
      const value = parseXlm(minPrice);
      return value > 0n ? value : null;
    } catch {
      return null;
    }
  })();
  const ledgerNow = ledger ?? anchor?.ledger ?? null;
  const parsedDuration = /^[1-9][0-9]*$/.test(durationAmount.trim()) ? Number(durationAmount.trim()) : null;

  const closeLedger =
    parsedDuration === null || anchor === null || ledgerNow === null
      ? null
      : ledgerNow + durationToLedgers(parsedDuration, durationUnit, anchor.secondsPerLedger);
  const closeIn = closeLedger === null || ledgerNow === null || anchor === null ? null : formatDuration((closeLedger - ledgerNow) * anchor.secondsPerLedger);

  const stepValid = (index: number): boolean => {
    if (index === 0) return asset !== null && (assetBalance === null || parsedQuotas === null || assetBalance > 0n);
    if (index === 1) return parsedQuotas !== null && parsedMin !== null;
    if (index === 2) {
      if (closeLedger === null || ledgerNow === null) return false;
      return closeLedger > ledgerNow && closeLedger - ledgerNow <= MAX_DURATION_LEDGERS;
    }
    return true;
  };

  const next = (): void => {
    setFieldError(null);
    if (step === 0 && asset === null) {
      setFieldError("Read the asset address before continuing.");
      return;
    }
    if (step === 0 && assetBalance !== null && parsedQuotas !== null && assetBalance < BigInt(parsedQuotas)) {
      setFieldError("The company does not have enough quotas of this asset.");
      return;
    }
    if (step === 1) {
      if (parsedQuotas === null) {
        setFieldError("Enter a whole number of quotas greater than zero.");
        return;
      }
      if (parsedMin === null) {
        setFieldError("Enter a minimum price greater than zero.");
        return;
      }
      if (assetBalance !== null && BigInt(parsedQuotas) > assetBalance) {
        setFieldError("The quantity asks for more quotas than the company holds in this asset.");
        return;
      }
    }
    if (step === 2) {
      if (parsedDuration === null) {
        setFieldError("Enter a whole duration greater than zero.");
        return;
      }
      if (closeLedger === null || ledgerNow === null) {
        setFieldError("Reading the ledger clock; try again in a moment.");
        return;
      }
      if (closeLedger - ledgerNow > MAX_DURATION_LEDGERS) {
        setFieldError("The maximum duration is 30 days.");
        return;
      }
    }
    setStep((value) => Math.min(value + 1, STEPS.length - 1));
  };

  const create = async (): Promise<void> => {
    setError(null);
    setFieldError(null);
    if (cmi === null || asset === null || parsedQuotas === null || parsedMin === null || closeLedger === null || ledgerNow === null) {
      setFieldError("Review the data: something is missing to create the auction.");
      return;
    }
    if (registerData === null) {
      setError(new Error("register-data missing"));
      return;
    }
    let reserve: bigint;
    try {
      reserve = parseXlm(feeReserve);
    } catch {
      setFieldError("Invalid fee reserve.");
      return;
    }
    const params: MarketParams = {
      quotaAsset: assetInput.trim(),
      totalQuotas: parsedQuotas,
      minPricePerQuota: parsedMin,
      closeLedger,
      eligibilityPolicy: null,
      feeReserve: reserve,
    };
    try {
      checkMarketParams(params, ledgerNow);
    } catch (cause) {
      setError(cause);
      return;
    }
    if (status.data === undefined || !status.data.onChain || !status.data.hasKey) {
      setFieldError("Create and register the confidential account before selling.");
      return;
    }
    setCreating(true);
    try {
      const provider = new StaticRegisterDataProvider({ factory: cmi.client.factory, registerData });
      const created = await cmi.client.seller.createMarket(params, provider);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["markets"] }),
        queryClient.invalidateQueries({ queryKey: ["market"] }),
        queryClient.invalidateQueries({ queryKey: ["public-account"] }),
      ]);
      toast.success(`Auction #${created.marketId.toString()} created. Open it when the quotas are ready.`);
      navigate(`/company/market/${created.marketId.toString()}`);
    } catch (cause) {
      setError(cause);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/company" className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-3 hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Company
      </Link>
      <PageHeader
        eyebrow="New auction"
        title="Set up auction"
        description="Four steps. Nothing is sent until review; the wallet signs only at creation."
        className="mt-4"
      />

      <ol className="mb-7 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]">
        {STEPS.map((label, index) => (
          <li key={label} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => index < step && setStep(index)}
              disabled={index > step}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium transition-colors",
                index === step ? "bg-primary-soft text-primary" : index < step ? "text-ink-2 hover:bg-sunken" : "text-ink-3",
              )}
            >
              <span className="numeric text-[10.5px]">{index < step ? <Check className="h-3 w-3" aria-hidden /> : `0${index + 1}`}</span>
              {label}
            </button>
            {index < STEPS.length - 1 && <span className="h-px w-4 bg-line" aria-hidden />}
          </li>
        ))}
      </ol>

      <div className="rounded-sheet border border-line bg-surface p-6">
        {step === 0 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold">Quota asset</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                The SAC address of the asset the company issues. The asset cannot have clawback; one quota is one whole
                unit of the asset.
              </p>
            </div>
            <Field id="quota-asset" label="SAC address" hint="C… — the asset that will be held in custody by the contract.">
              <div className="flex gap-2">
                <Input
                  id="quota-asset"
                  value={assetInput}
                  onChange={(event) => {
                    setAssetInput(event.target.value);
                    setAsset(null);
                    setAssetBalance(null);
                    setTrustline(null);
                  }}
                  placeholder="C…"
                  className="font-mono text-xs"
                  spellCheck={false}
                />
                <Button variant="secondary" onClick={() => void readAsset()} loading={reading} disabled={assetInput.trim() === ""}>
                  Read asset
                </Button>
              </div>
            </Field>
            {asset !== null && (
              <div className="border-y border-line py-3 text-[13px]">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="text-ink-2">Asset</span>
                  <span className="numeric font-medium">{asset.label}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap justify-between gap-2">
                  <span className="text-ink-2">Company balance</span>
                  <span className="numeric font-medium">
                    {assetBalance === null ? "could not be read" : `${formatXlm(assetBalance)} units`}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-ink-2">Wallet trustline</span>
                  {trustline === true ? (
                    <span className="inline-flex items-center gap-1 text-success">
                      <Check className="h-3.5 w-3.5" aria-hidden /> enabled
                    </span>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => void enableAsset()}>
                      Enable asset
                    </Button>
                  )}
                </div>
              </div>
            )}
            <InlineNote>
              Need to issue a test asset? The <code className="font-mono text-[11.5px]">pnpm token:issue</code> script creates
              a token without clawback and prints the SAC address.
            </InlineNote>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold">Quantity and floor</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                Both values are public. The floor keeps out irrelevant bids; it is not the sale price.
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="total-quotas" label="Total quotas" hint={assetBalance === null ? "Positive whole number." : `The company holds ${formatXlm(assetBalance)} units.`}>
                <Input id="total-quotas" inputMode="numeric" value={totalQuotas} onChange={(event) => setTotalQuotas(event.target.value)} placeholder="1000" />
              </Field>
              <Field id="min-price" label="Floor per quota" hint="Public; in XLM per quota.">
                <Input id="min-price" inputMode="decimal" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} placeholder="10.00" suffix="XLM" />
              </Field>
            </div>
            {parsedQuotas !== null && parsedMin !== null && (
              <p className="text-[12.5px] text-ink-3">
                If all {formatQuotas(parsedQuotas)} sell at the floor: a minimum of{" "}
                <span className="numeric text-ink-2">{formatXlm(BigInt(parsedQuotas) * parsedMin)} XLM</span> in bids.
              </p>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold">Duration and reserve</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                How long bidding stays open, counted from now. It is converted into a ledger, which is what the contract
                sees. Maximum of 30 days.
              </p>
            </div>
            <Field id="duration" label="Bidding open for" hint={closeLedger === null ? "Estimate from the current ledger." : `≈ ledger ${closeLedger.toLocaleString("en-US")} (estimated)`}>
              <div className="flex gap-2">
                <Input
                  id="duration"
                  inputMode="numeric"
                  value={durationAmount}
                  onChange={(event) => setDurationAmount(event.target.value)}
                  placeholder="7"
                />
                <select
                  aria-label="Duration unit"
                  value={durationUnit}
                  onChange={(event) => setDurationUnit(event.target.value as DurationUnit)}
                  className="h-10 rounded-control border border-line-strong bg-surface px-3 text-sm text-ink transition-colors hover:border-ink-3/60 focus:border-primary focus:outline-none"
                >
                  {DURATION_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field
              id="fee-reserve"
              label="Fee reserve"
              hint={`Stays in the contract to cover settlement; whatever is left returns to the seller. Minimum ${formatXlm(MIN_FEE_RESERVE)} XLM.`}
            >
              <Input id="fee-reserve" inputMode="decimal" value={feeReserve} onChange={(event) => setFeeReserve(event.target.value)} suffix="XLM" />
            </Field>
            {closeIn !== null && (
              <p className="text-[12.5px] text-ink-3">Bidding closes in about {closeIn}, by the ledger clock.</p>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold">Review</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                Check everything before signing. Once created, the auction parameters are immutable.
              </p>
            </div>
            <dl className="divide-y divide-line border-y border-line text-[13px]">
              {[
                ["Asset", asset?.label ?? "—"],
                ["Total quotas", parsedQuotas === null ? "—" : formatQuotas(parsedQuotas)],
                ["Floor per quota", parsedMin === null ? "—" : `${formatXlm(parsedMin)} XLM`],
                ["Close", closeLedger === null ? "—" : `in ${closeIn ?? "—"} · ledger ${closeLedger.toLocaleString("en-US")}`],
                ["Fee reserve", `${feeReserve} XLM`],
                ["Rule", "Pay-as-bid · highest price first · up to 8 bids · 1 per wallet"],
              ].map(([term, value]) => (
                <div key={term} className="flex justify-between gap-4 py-2.5">
                  <dt className="text-ink-2">{term}</dt>
                  <dd className={term === "Asset" ? "numeric text-right font-medium" : "text-right font-medium"}>{value}</dd>
                </div>
              ))}
            </dl>
            {parsedMin !== null && (
              <div className="rounded-control bg-sunken/60 px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">
                Platform fee: 10% per quota sold. For every P XLM per quota, the company receives{" "}
                <span className="numeric font-medium text-ink">{formatXlm((parsedMin * 9n) / 10n)} XLM</span>.
              </div>
            )}
            {registerData === null && (
              <div className="border-l-2 border-warning bg-warning/[0.05] px-4 py-3 text-[13px] text-ink-2">
                This environment has no <code className="font-mono text-[11.5px]">registerData</code>. Run{" "}
                <code className="font-mono text-[11.5px]">pnpm register-data</code> and update{" "}
                <code className="font-mono text-[11.5px]">app/public/config/testnet.json</code>.
              </div>
            )}
            {status.data !== undefined && (!status.data.onChain || !status.data.hasKey) && (
              <div className="border-l-2 border-warning bg-warning/[0.05] px-4 py-3 text-[13px] text-ink-2">
                The confidential account is not ready yet.{" "}
                <Link to="/wallet" className="font-semibold text-primary">
                  Resolve in wallet
                </Link>
                .
              </div>
            )}
          </div>
        )}

        {fieldError !== null && <p role="alert" className="mt-4 text-[13px] text-danger">{fieldError}</p>}
        {error !== null && <ErrorNotice error={error} className="mt-4" />}

        <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
          <Button variant="ghost" onClick={() => (step === 0 ? navigate("/company") : setStep((value) => value - 1))}>
            {step === 0 ? "Cancel" : "Back"}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={next} disabled={!stepValid(step)} icon={<ArrowRight className="h-4 w-4" aria-hidden />}>
              Continue
            </Button>
          ) : (
            <Button onClick={() => void create()} loading={creating} disabled={registerData === null}>
              {creating ? "Creating…" : "Create auction"}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-[12px] text-ink-3">
        {anchor === null ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />}
        {anchor === null ? "Reading the ledger…" : "Times are estimated from the ledger clock."}
      </div>
    </div>
  );
}
