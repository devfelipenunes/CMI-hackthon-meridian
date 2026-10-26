import { Address, contract, nativeToScVal, xdr } from "@stellar/stellar-sdk";

import type { MarketConfig, MarketParams, PlatformConfig } from "../config/types.js";
import { CmiError } from "../errors/CmiError.js";

export const addrVal = (a: string): xdr.ScVal => new Address(a).toScVal();
export const u32Val = (n: number): xdr.ScVal => xdr.ScVal.scvU32(n);
export const u64Val = (n: bigint): xdr.ScVal => nativeToScVal(n, { type: "u64" });
export const bytesVal = (b: Uint8Array): xdr.ScVal => xdr.ScVal.scvBytes(Buffer.from(b));

export const udt = (name: string): xdr.ScSpecTypeDef => xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name }));

export function lazySpec(entries: readonly string[]): () => contract.Spec {
  let spec: contract.Spec | undefined;
  return () => (spec ??= new contract.Spec([...entries]));
}

export function bytesOf(v: unknown, what: string): Uint8Array {
  if (v instanceof Uint8Array) return new Uint8Array(v);
  throw new CmiError("TxFailed", `unexpected ${what} in contract response`);
}

export function tagOf(v: unknown, what: string): string {
  const tag = (v as { tag?: unknown } | null)?.tag;
  if (typeof tag !== "string") throw new CmiError("TxFailed", `unexpected ${what} in contract response`);
  return tag;
}

export function paramsToNative(p: MarketParams): Record<string, unknown> {
  return {
    quota_asset: p.quotaAsset,
    total_quotas: p.totalQuotas,
    min_price_per_quota: p.minPricePerQuota,
    close_ledger: p.closeLedger,
    eligibility_policy: p.eligibilityPolicy ?? undefined,
    fee_reserve: p.feeReserve,
  };
}

type Native = Record<string, unknown>;

function paramsFromNative(n: Native): MarketParams {
  return {
    quotaAsset: n.quota_asset as string,
    totalQuotas: n.total_quotas as number,
    minPricePerQuota: BigInt(n.min_price_per_quota as bigint),
    closeLedger: n.close_ledger as number,
    eligibilityPolicy: (n.eligibility_policy as string | null | undefined) ?? null,
    feeReserve: BigInt(n.fee_reserve as bigint),
  };
}

export function platformFromNative(n: Native): PlatformConfig {
  return {
    collateralToken: n.collateral_token as string,
    feeAsset: n.fee_asset as string,
    bidVerifier: n.bid_verifier as string,
    allocationVerifier: n.allocation_verifier as string,
    settlementVerifier: n.settlement_verifier as string,
    feeWallet: n.fee_wallet as string,
    auditorId: n.auditor_id as number,
    finalizationGraceLedgers: n.finalization_grace_ledgers as number,
  };
}

export function marketConfigFromNative(n: Native): MarketConfig {
  return {
    marketId: BigInt(n.market_id as bigint),
    seller: n.seller as string,
    params: paramsFromNative(n.params as Native),
    platform: platformFromNative(n.platform as Native),
    finalizationGraceLedgers: n.finalization_grace_ledgers as number,
    feeBps: n.fee_bps as number,
    auctionRule: n.auction_rule as number,
    maxBids: n.max_bids as number,
  };
}
