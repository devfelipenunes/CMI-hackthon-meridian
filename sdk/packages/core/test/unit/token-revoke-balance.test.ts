import { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import {
  Secret,
  decryptIncomingTransfer,
  encodeRevokeSpenderData,
  openSpendableBalance,
  pedersenCommit,
} from "../../src/index.js";
import { legsScenario } from "../helpers/legs.js";
import { revokeScenario } from "../helpers/revoke.js";

describe("buildRevokeSpenderWitness (saída do bidder, OQ-15)", () => {
  it("next opening is spend.v + vA (the allowance returns to spendable)", () => {
    const { revoke } = revokeScenario();
    expect(revoke.next.expose().v).toBe(170_000n + 130_000n);
  });

  it("revoke works with an expired delegation (the witness does not depend on live_until)", () => {
    const { revoke } = revokeScenario();
    expect(Object.keys(revoke.inputs).some((k) => /live|ledger|until/.test(k))).toBe(false);
  });

  it("next is Secret and the payload carries no amount in clear", () => {
    const { revoke } = revokeScenario();
    expect(revoke.next).toBeInstanceOf(Secret);
    const json = JSON.stringify(revoke.payload, (_k, v) => (typeof v === "bigint" ? v.toString(16) : v));
    expect(json).not.toContain((300_000n).toString(16).padStart(6, "0"));
  });

  it("encodeRevokeSpenderData has the POC-5 RevokeSpenderPayload fields, sorted", () => {
    const { revoke } = revokeScenario();
    const map = xdr.ScVal.fromXDR(Buffer.from(encodeRevokeSpenderData(revoke, new Uint8Array(32)))).map()!;
    expect(map[0]!.val().map()!.map((e) => e.key().sym().toString())).toEqual([
      "b_aud_s", "b_tilde", "c_spend_new", "r_e", "sigma", "v_aud_s",
    ]);
  });
});

describe("openSpendableBalance", () => {
  it("recovers v from b_tilde (the set_spender event) and matches the on-chain commitment", () => {
    const { f, setSpender } = legsScenario();
    const opened = openSpendableBalance(
      { bTilde: setSpender.payload.bTilde, sigma: setSpender.payload.sigma, commitment: setSpender.payload.cSpendNew },
      f.bidder,
    ).expose();
    expect(opened.v).toBe(170_000n);
    expect(pedersenCommit(opened.v, opened.r)).toEqual(setSpender.payload.cSpendNew);
  });

  it("with another account's keys the opening does not match the commitment (RangeError)", () => {
    const { f, setSpender } = legsScenario();
    expect(() =>
      openSpendableBalance({ bTilde: setSpender.payload.bTilde, sigma: setSpender.payload.sigma, commitment: setSpender.payload.cSpendNew }, f.seller),
    ).toThrow(RangeError);
  });
});

describe("decryptIncomingTransfer", () => {
  it("decryptIncomingTransfer recovers the 52.000 refund (POC-6 case) with the bidder's vk", () => {
    const { f, legs } = legsScenario();
    const ev = { rE: legs.refund.payload.rE, vTilde: legs.refund.payload.vTilde, sigma: legs.fee.next.expose().sigmaA };
    const got = decryptIncomingTransfer(ev, f.bidder.vk).expose();
    expect(got.vTx).toBe(52_000n);
    expect(pedersenCommit(got.vTx, got.rTx)).toEqual(legs.refund.payload.cTx);
  });

  it("the seller decrypts its 70.200 payment (D20: the seller learns each winner's payment)", () => {
    const { f, legs, recovered } = legsScenario();
    const ev = { rE: legs.seller.payload.rE, vTilde: legs.seller.payload.vTilde, sigma: recovered.expose().sigmaA };
    expect(decryptIncomingTransfer(ev, f.seller.vk).expose().vTx).toBe(70_200n);
  });

  it("with wrong vk does not return the amount", () => {
    const { f, legs } = legsScenario();
    const ev = { rE: legs.refund.payload.rE, vTilde: legs.refund.payload.vTilde, sigma: legs.fee.next.expose().sigmaA };
    expect(decryptIncomingTransfer(ev, f.seller.vk).expose().vTx).not.toBe(52_000n);
  });
});
