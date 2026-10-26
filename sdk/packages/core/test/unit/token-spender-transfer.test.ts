import { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import {
  Secret,
  buildSpenderTransferWitness,
  decodeSpenderTransferData,
  encodeSpenderTransferData,
  pedersenCommit,
  recoverDelegation,
} from "../../src/index.js";
import { legsScenario } from "../helpers/legs.js";

describe("recoverDelegation (lado do spender, ADR-023)", () => {
  it("returns vA, dvk and rA from on-chain fields and sk_op", () => {
    const { setSpender, recovered } = legsScenario();
    const d = setSpender.delegation.expose();
    const r = recovered.expose();
    expect(r.vA).toBe(130_000n);
    expect(r.dvk).toBe(d.dvk);
    expect(r.rA).toBe(d.rA);
    expect(r.sigmaA).toBe(d.sigmaA);
    expect(pedersenCommit(r.vA, r.rA)).toEqual(setSpender.payload.cA);
  });

  it("with another sk_op returns garbage, not the price", () => {
    const { onChain, f } = legsScenario();
    const r = recoverDelegation(onChain, new Secret(f.auction.sk.expose() + 1n), f.params.opI).expose();
    expect(r.vA).not.toBe(130_000n);
  });

  it("returns a Secret", () => {
    expect(legsScenario().recovered).toBeInstanceOf(Secret);
  });
});

describe("buildSpenderTransferWitness — 3 pernas encadeadas", () => {
  it("three chained legs consume allowance exactly (final allowance is 0)", () => {
    const { legs, amounts } = legsScenario();
    expect(amounts.seller + amounts.fee + amounts.refund).toBe(130_000n);
    expect(legs.seller.next.expose().vA).toBe(130_000n - 70_200n);
    expect(legs.fee.next.expose().vA).toBe(52_000n);
    expect(legs.refund.next.expose().vA).toBe(0n);
  });

  it("leg 2 is built from leg 1 nextAllowance: its C_a is leg 1's c_a_new", () => {
    const { legs } = legsScenario();
    expect(legs.fee.inputs.c_a_x).toBe(legs.seller.inputs.c_a_new_x);
    expect(legs.fee.inputs.c_a_y).toBe(legs.seller.inputs.c_a_new_y);
  });

  it("leg 2 built over the ORIGINAL allowance does not match the token state after leg 1", () => {
    const { legs, recovered, common, amounts, f } = legsScenario();
    const wrong = buildSpenderTransferWitness({ ...common, allowance: recovered, vTx: amounts.fee, pvkRecipient: f.feeWallet.PVK }, f.rng);
    expect(wrong.inputs.c_a_x).not.toBe(legs.seller.inputs.c_a_new_x);
  });

  it("c_tx of each leg commits to its amount (recipient view)", () => {
    const { legs } = legsScenario();
    const v = legs.seller.recipientView.expose();
    expect(v.vTx).toBe(70_200n);
    expect(pedersenCommit(v.vTx, v.rTx)).toEqual(legs.seller.payload.cTx);
  });

  it("rejects vTx above the allowance", () => {
    const { common, legs, f } = legsScenario();
    expect(() =>
      buildSpenderTransferWitness({ ...common, allowance: legs.fee.next, vTx: 52_001n, pvkRecipient: f.bidder.PVK }, f.rng),
    ).toThrow(RangeError);
  });

  it("the new salt always differs from the current one (salt-rotation constraint)", () => {
    const { legs, recovered } = legsScenario();
    expect(legs.seller.payload.sigmaANew).not.toBe(recovered.expose().sigmaA);
  });

  it("next and recipientView are Secret", () => {
    const { legs } = legsScenario();
    expect(legs.seller.next).toBeInstanceOf(Secret);
    expect(legs.seller.recipientView).toBeInstanceOf(Secret);
  });
});

describe("SpenderTransfer codec", () => {
  const { legs } = legsScenario();
  const proof = Uint8Array.from({ length: 128 }, (_, i) => 255 - i);

  it("decodeSpenderTransferData(encode(x)) == x", () => {
    const decoded = decodeSpenderTransferData(encodeSpenderTransferData(legs.seller, proof));
    expect(decoded.payload).toEqual(legs.seller.payload);
    expect(Buffer.from(decoded.proof).equals(Buffer.from(proof))).toBe(true);
  });

  it("decoded c_tx is the witness point (what the settlement proof binds)", () => {
    expect(decodeSpenderTransferData(encodeSpenderTransferData(legs.refund, proof)).payload.cTx).toEqual(legs.refund.payload.cTx);
  });

  it("has the POC-5 SpenderTransferPayload fields, sorted", () => {
    const map = xdr.ScVal.fromXDR(Buffer.from(encodeSpenderTransferData(legs.fee, proof))).map()!;
    expect(map[0]!.val().map()!.map((e) => e.key().sym().toString())).toEqual([
      "a_aud_s", "a_tilde_new", "c_a_new", "c_tx", "r_aud_r", "r_e", "sigma_a_new", "v_aud_r", "v_aud_s", "v_tilde",
    ]);
  });

  it("decode rejects malformed bytes with a RangeError", () => {
    expect(() => decodeSpenderTransferData(new Uint8Array([1, 2, 3]))).toThrow(RangeError);
  });
});
