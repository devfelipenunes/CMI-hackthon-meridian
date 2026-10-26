import { deriveAllowR, dvkFromVkOp } from "@ctd/sdk";
import { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import {
  Secret,
  buildSetSpenderWitness,
  encodeSetSpenderData,
  pedersenCommit,
  pointToBytes,
  toBytes32BE,
} from "../../src/index.js";

import { fixture } from "../helpers/token-fixture.js";

describe("buildSetSpenderWitness (RF-09)", () => {
  it("delegation.cA equals pedersenCommit(vA, rA)", () => {
    const { params, rng } = fixture();
    const w = buildSetSpenderWitness(params, rng);
    const d = w.delegation.expose();
    expect(w.payload.cA).toEqual(pedersenCommit(130_000n, d.rA));
    expect(d.vA).toBe(130_000n);
  });

  it("rA derives from (dvk, sigmaA), and dvk from (vk, opI) — not free", () => {
    const { params, rng } = fixture();
    const w = buildSetSpenderWitness(params, rng);
    const d = w.delegation.expose();
    expect(d.dvk).toBe(dvkFromVkOp(params.keys.vk.expose(), params.opI));
    expect(d.rA).toBe(deriveAllowR(d.dvk, d.sigmaA));
    expect(w.payload.sigmaA).toBe(d.sigmaA);
  });

  it("rejects vA above spendable balance, and a non-positive vA", () => {
    const { params, rng } = fixture();
    expect(() => buildSetSpenderWitness({ ...params, vA: 300_001n }, rng)).toThrow(RangeError);
    expect(() => buildSetSpenderWitness({ ...params, vA: 0n }, rng)).toThrow(RangeError);
  });

  it("next opening is v − vA", () => {
    const { params, rng } = fixture();
    expect(buildSetSpenderWitness(params, rng).next.expose().v).toBe(170_000n);
  });

  it("sigmaA comes from the injected Rng (deterministic per seed)", () => {
    const a = buildSetSpenderWitness(fixture(5n).params, fixture(5n).rng);
    const b = buildSetSpenderWitness(fixture(5n).params, fixture(5n).rng);
    const c = buildSetSpenderWitness(fixture(6n).params, fixture(6n).rng);
    expect(a.payload).toEqual(b.payload);
    expect(a.payload.cA).not.toEqual(c.payload.cA);
  });

  it("delegation and next are Secret; the payload carries no vA, dvk or rA", () => {
    const { params, rng } = fixture();
    const w = buildSetSpenderWitness(params, rng);
    expect(w.delegation).toBeInstanceOf(Secret);
    expect(w.next).toBeInstanceOf(Secret);
    const d = w.delegation.expose();
    const json = JSON.stringify(w.payload, (_k, v) => (typeof v === "bigint" ? v.toString(16) : v));
    for (const s of [d.dvk, d.rA, 130_000n, 170_000n]) expect(json).not.toContain(s.toString(16).padStart(8, "0"));
  });
});

describe("encodeSetSpenderData", () => {
  const { params, rng } = fixture();
  const w = buildSetSpenderWitness(params, rng);
  const proof = Uint8Array.from({ length: 64 }, (_, i) => i);
  const map = xdr.ScVal.fromXDR(Buffer.from(encodeSetSpenderData(w, proof))).map()!;
  const payload = new Map(map[0]!.val().map()!.map((e) => [e.key().sym().toString(), Buffer.from(e.val().bytes())]));

  it("is XDR {payload, proof} with the POC-5 SetSpenderPayload fields, sorted", () => {
    expect(map.map((e) => e.key().sym().toString())).toEqual(["payload", "proof"]);
    expect([...payload.keys()]).toEqual([
      "a_tilde", "b_aud_s", "b_tilde", "c_a", "c_spend_new", "escrowed_dvk", "r_e", "sigma", "sigma_a", "v_aud_s",
    ]);
  });

  it("each field carries the witness payload value (points 64 bytes, fields 32)", () => {
    const p = w.payload;
    const eq = (k: string, bytes: Uint8Array) => expect(payload.get(k)!.equals(Buffer.from(bytes)), k).toBe(true);
    eq("c_a", pointToBytes(p.cA));
    eq("c_spend_new", pointToBytes(p.cSpendNew));
    eq("r_e", pointToBytes(p.rE));
    eq("escrowed_dvk", new Uint8Array([...toBytes32BE(p.escrowedDvk.rX), ...toBytes32BE(p.escrowedDvk.cipher)]));
    eq("a_tilde", toBytes32BE(p.aTilde));
    eq("b_tilde", toBytes32BE(p.bTilde));
    eq("sigma", toBytes32BE(p.sigma));
    eq("sigma_a", toBytes32BE(p.sigmaA));
    eq("v_aud_s", toBytes32BE(p.vAudS));
    eq("b_aud_s", toBytes32BE(p.bAudS));
  });
});
