import { scvStruct } from "@ctd/sdk";
import { sha256 } from "@noble/hashes/sha2";
import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";

import type { MarketConfig, MarketParams, PlatformConfig } from "./types.js";

export function configHash(config: MarketConfig): Uint8Array {
  return sha256(marketConfigVal(config).toXDR());
}

const U32_MAX = 2 ** 32 - 1;
const U64_MAX = 2n ** 64n - 1n;
const I128_MIN = -(2n ** 127n);
const I128_MAX = 2n ** 127n - 1n;

function u32(v: number): xdr.ScVal {
  if (!Number.isInteger(v) || v < 0 || v > U32_MAX) throw new RangeError(`u32 out of range: ${v}`);
  return xdr.ScVal.scvU32(v);
}

function u64(v: bigint): xdr.ScVal {
  if (v < 0n || v > U64_MAX) throw new RangeError(`u64 out of range: ${v}`);
  return nativeToScVal(v, { type: "u64" });
}

function i128(v: bigint): xdr.ScVal {
  if (v < I128_MIN || v > I128_MAX) throw new RangeError(`i128 out of range: ${v}`);
  return nativeToScVal(v, { type: "i128" });
}

const address = (a: string): xdr.ScVal => new Address(a).toScVal();

function paramsVal(p: MarketParams): xdr.ScVal {
  return scvStruct({
    quota_asset: address(p.quotaAsset),
    total_quotas: u32(p.totalQuotas),
    min_price_per_quota: u64(p.minPricePerQuota),
    close_ledger: u32(p.closeLedger),
    eligibility_policy: p.eligibilityPolicy === null ? xdr.ScVal.scvVoid() : address(p.eligibilityPolicy),
    fee_reserve: i128(p.feeReserve),
  });
}

function platformVal(p: PlatformConfig): xdr.ScVal {
  return scvStruct({
    collateral_token: address(p.collateralToken),
    fee_asset: address(p.feeAsset),
    bid_verifier: address(p.bidVerifier),
    allocation_verifier: address(p.allocationVerifier),
    settlement_verifier: address(p.settlementVerifier),
    fee_wallet: address(p.feeWallet),
    auditor_id: u32(p.auditorId),
    finalization_grace_ledgers: u32(p.finalizationGraceLedgers),
  });
}

function marketConfigVal(c: MarketConfig): xdr.ScVal {
  return scvStruct({
    market_id: u64(c.marketId),
    seller: address(c.seller),
    params: paramsVal(c.params),
    platform: platformVal(c.platform),
    finalization_grace_ledgers: u32(c.finalizationGraceLedgers),
    fee_bps: u32(c.feeBps),
    auction_rule: u32(c.auctionRule),
    max_bids: u32(c.maxBids),
  });
}
