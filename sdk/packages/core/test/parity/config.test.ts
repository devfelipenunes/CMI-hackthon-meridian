import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { contract, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { AUCTION_SPEC } from "../../src/bindings/auction.js";
import { configHash, hashLimbs, type MarketConfig } from "../../src/index.js";
import { marketConfigFromNative } from "../../src/ports/scval.js";

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

const vector = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../contracts/artifacts/parity-vectors/config_hash.json", import.meta.url)), "utf8")) as {
  config_xdr: string;
  config_hash: string;
  lo: string;
  hi: string;
};
const spec = new contract.Spec([...AUCTION_SPEC]);
const udt = (name: string) => xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name }));
const base: MarketConfig = marketConfigFromNative(spec.scValToNative(xdr.ScVal.fromXDR(vector.config_xdr, "hex"), udt("MarketConfig")) as Record<string, unknown>);
const c = { platform: base.platform };

const OTHER = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMDR4";

describe("configHash parity with the contracts (D-03)", () => {
  it("configHash matches contracts config_hash.json", () => {
    expect(hex(configHash(base))).toBe(vector.config_hash);
  });

  it("the platform grace of the vector is a per-market field (ADR-027)", () => {
    expect(base.platform.finalizationGraceLedgers).toBe(base.finalizationGraceLedgers);
  });

  it("lo and hi limbs match the vector", () => {
    const { lo, hi } = hashLimbs(configHash(base));
    expect(lo).toBe(BigInt(`0x${vector.lo}`));
    expect(hi).toBe(BigInt(`0x${vector.hi}`));
  });

  it.each<[string, (m: MarketConfig) => MarketConfig]>([
    ["marketId", (m) => ({ ...m, marketId: m.marketId + 1n })],
    ["seller", (m) => ({ ...m, seller: OTHER })],
    ["params.quotaAsset", (m) => ({ ...m, params: { ...m.params, quotaAsset: OTHER } })],
    ["params.totalQuotas", (m) => ({ ...m, params: { ...m.params, totalQuotas: m.params.totalQuotas + 1 } })],
    ["params.minPricePerQuota", (m) => ({ ...m, params: { ...m.params, minPricePerQuota: m.params.minPricePerQuota + 1n } })],
    ["params.closeLedger", (m) => ({ ...m, params: { ...m.params, closeLedger: m.params.closeLedger + 1 } })],
    ["params.eligibilityPolicy", (m) => ({ ...m, params: { ...m.params, eligibilityPolicy: OTHER } })],
    ["params.feeReserve", (m) => ({ ...m, params: { ...m.params, feeReserve: m.params.feeReserve + 1n } })],
    ["platform.collateralToken", (m) => ({ ...m, platform: { ...m.platform, collateralToken: OTHER } })],
    ["platform.feeAsset", (m) => ({ ...m, platform: { ...m.platform, feeAsset: OTHER } })],
    ["platform.bidVerifier", (m) => ({ ...m, platform: { ...m.platform, bidVerifier: c.platform.allocationVerifier } })],
    ["platform.allocationVerifier", (m) => ({ ...m, platform: { ...m.platform, allocationVerifier: OTHER } })],
    ["platform.settlementVerifier", (m) => ({ ...m, platform: { ...m.platform, settlementVerifier: OTHER } })],
    ["platform.feeWallet", (m) => ({ ...m, platform: { ...m.platform, feeWallet: OTHER } })],
    ["platform.auditorId", (m) => ({ ...m, platform: { ...m.platform, auditorId: m.platform.auditorId + 1 } })],
    ["platform.finalizationGraceLedgers", (m) => ({ ...m, platform: { ...m.platform, finalizationGraceLedgers: m.platform.finalizationGraceLedgers + 1 } })],
    ["finalizationGraceLedgers", (m) => ({ ...m, finalizationGraceLedgers: m.finalizationGraceLedgers + 1 })],
    ["feeBps", (m) => ({ ...m, feeBps: m.feeBps + 1 })],
    ["auctionRule", (m) => ({ ...m, auctionRule: m.auctionRule + 1 })],
    ["maxBids", (m) => ({ ...m, maxBids: m.maxBids + 1 })],
  ])("any field change changes the hash: %s", (_field, change) => {
    expect(hex(configHash(change(base)))).not.toBe(vector.config_hash);
  });

  it.each<[string, MarketConfig]>([
    ["u32 above 2^32 - 1", { ...base, params: { ...base.params, totalQuotas: 2 ** 32 } }],
    ["negative u32", { ...base, feeBps: -1 }],
    ["u64 at 2^64", { ...base, marketId: 2n ** 64n }],
    ["i128 at 2^127", { ...base, params: { ...base.params, feeReserve: 2n ** 127n } }],
  ])("rejects values outside the contract types: %s", (_case, bad) => {
    expect(() => configHash(bad)).toThrow(RangeError);
  });
});
