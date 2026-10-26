import { createHash } from "node:crypto";
import { assertNoSecretLeak } from "@zolvency-cmi/testing";
import { describe, expect, it } from "vitest";

import { buildEvidence, RC1_CHECKS, RC2_CHECKS, RC3_CHECKS, ROUND_CHECKS, ROUND_VKS, roundOf, type CheckOutcome } from "../src/evidence.js";

const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

function sample(checks: CheckOutcome[]) {
  return buildEvidence({
    contractsTag: "v0.1.0-rc.1",
    contractsCommit: "6a6cba29a5cf6eb07ea185a5c4cdb6e61b98e215",
    sdkCommit: "0123456789abcdef0123456789abcdef01234567",
    network: "quickstart-local",
    runAt: new Date("2026-10-13T12:00:00Z"),
    wasm: new Map([["factory", bytes("f")], ["auction", bytes("a")], ["confidential_token", bytes("t")], ["ultrahonk_verifier", bytes("u")]]),
    vks: new Map([["bid_validity", bytes("vk")]]),
    checks,
  });
}

const pass = (id: string, extra: Partial<CheckOutcome> = {}): CheckOutcome => ({ id, result: "PASS", ...extra });

describe("evidência E2E (contracts TESTING §6.2)", () => {
  it("evidence JSON follows contracts TESTING §6.2 schema", () => {
    const e = sample([pass("RF-09.lock_real_set_spender", { tx: "ab".repeat(32) }), pass("RF-11.submit_bid_real_ca_accepted", { tx: "cd".repeat(32), cpu: 82_441_222 })]);
    const j = JSON.parse(JSON.stringify(e)) as Record<string, unknown>;
    expect(Object.keys(j)).toEqual(["contracts_tag", "contracts_commit", "sdk_commit", "network", "run_at", "wasm_sha256", "vk_sha256", "checks", "summary"]);
    expect(j.run_at).toBe("2026-10-13T12:00:00.000Z");
    expect(Object.keys(j.wasm_sha256 as object)).toEqual(["factory", "auction", "confidential_token", "ultrahonk_verifier"]);
    expect(j.checks).toEqual([
      { id: "RF-09.lock_real_set_spender", result: "PASS", tx: "ab".repeat(32) },
      { id: "RF-11.submit_bid_real_ca_accepted", result: "PASS", tx: "cd".repeat(32), cpu: 82_441_222 },
    ]);
  });

  it("summary counts match checks", () => {
    const e = sample([pass("a"), { id: "b", result: "FAIL", error: "Auction.InvalidBidProof" }, pass("c")]);
    expect(e.summary).toEqual({ pass: 2, fail: 1 });
  });

  it("wasm and vk sha256 come from fetched files", () => {
    const e = sample([]);
    expect(e.wasm_sha256.auction).toBe(sha(bytes("a")));
    expect(e.vk_sha256.bid_validity).toBe(sha(bytes("vk")));
    const other = buildEvidence({ ...sampleInput(), wasm: new Map([["factory", bytes("F")], ["auction", bytes("a")], ["confidential_token", bytes("t")], ["ultrahonk_verifier", bytes("u")]]) });
    expect(other.wasm_sha256.factory).not.toBe(e.wasm_sha256.factory);
  });

  it("evidence contains no secret", () => {
    const price = 650_123n;
    const blinding = 0x5eed_b1ad_0000_0007n;
    const leaky = { ...pass("RF-11.submit_bid_real_ca_accepted"), price, blinding, detail: `price=${price}` } as unknown as CheckOutcome;
    const e = sample([leaky]);
    assertNoSecretLeak([price, blinding], [JSON.stringify(e)]);
  });

  it("an error in a check is recorded by its code only", () => {
    const e = sample([{ id: "x", result: "FAIL", error: "CmiError: Auction.InvalidBidProof: 650 × 200 does not match" }]);
    expect(e.checks[0]).toEqual({ id: "x", result: "FAIL", error: "Auction.InvalidBidProof" });
  });

  it("RC2_CHECKS are the eight settlement ids", () => {
    expect([...RC2_CHECKS]).toEqual([
      "RF-20.settle_partial",
      "RF-20.settle_full",
      "RF-20.settle_zero",
      "RF-20.fee_skipped_rejected",
      "RF-20.fee_20pct_rejected",
      "RF-20.leg_rollback",
      "RF-20.release_after_real_revocation",
      "RF-20.settle_cpu_under_400m",
    ]);

  });

  it("RC3_CHECKS are the two full-auction ids", () => {
    expect([...RC3_CHECKS]).toEqual(["MVP.full_auction_8_bids_settled", "MVP.timeout_refunds"]);
    expect(ROUND_VKS.rc3).toEqual(["bid_validity", "winner_allocation", "settlement_binding"]);
    expect(roundOf("v0.1.0-rc.3")).toBe("rc3");
  });

  it("rc.4 onwards runs every round in one evidence (the interface changed: ADR-027)", () => {
    expect(roundOf("v0.1.0-rc.4")).toBe("all");
    expect(roundOf("v0.1.0-rc.7")).toBe("all");
    expect([...ROUND_CHECKS.all]).toEqual([...RC1_CHECKS, ...RC2_CHECKS, ...RC3_CHECKS]);
    expect(ROUND_CHECKS.all).toHaveLength(19);
    expect(ROUND_VKS.all).toEqual(["bid_validity", "winner_allocation", "settlement_binding"]);
  });

  it("each round carries the VKs of the circuits it exercises", () => {
    expect(ROUND_VKS.rc1).toEqual(["bid_validity"]);
    expect(ROUND_VKS.rc2).toEqual(["bid_validity", "winner_allocation", "settlement_binding"]);
    expect(roundOf("v0.1.0-rc.1")).toBe("rc1");
    expect(roundOf("v0.1.0-rc.2")).toBe("rc2");
    expect(() => roundOf("dev")).toThrow();
  });

  it("RC1_CHECKS are the nine ids of SDK TESTING §6.3", () => {
    expect([...RC1_CHECKS]).toEqual([
      "RF-08.auction_registers_in_real_token",
      "RF-09.lock_real_set_spender",
      "RF-11.submit_bid_real_ca_accepted",
      "RF-14.ca_of_other_value_rejected",
      "RF-14.short_live_until_rejected",
      "RF-09.revocation_detected",
      "RF-09.second_set_spender_fails_with_clear_sdk_error",
      "RF-11.below_min_creates_no_delegation",
      "RF-09.rejected_after_lock_revoke_returns_funds",
    ]);
  });
});

function sampleInput() {
  return {
    contractsTag: "v0.1.0-rc.1",
    contractsCommit: "6a6cba29a5cf6eb07ea185a5c4cdb6e61b98e215",
    sdkCommit: "0123456789abcdef0123456789abcdef01234567",
    network: "quickstart-local" as const,
    runAt: new Date("2026-10-13T12:00:00Z"),
    wasm: new Map<string, Uint8Array>(),
    vks: new Map([["bid_validity", bytes("vk")]]),
    checks: [] as CheckOutcome[],
  };
}
