import { describe, expect, it } from "vitest";

import { GRUMPKIN_G, encryptEnvelope, scalarMul } from "../../src/index.js";
import vectors from "../vectors/cmi-lib.json" with { type: "json" };

const v = vectors.envelope;
const pt = (p: { x: string; y: string }) => ({ x: BigInt(p.x), y: BigInt(p.y) });
const fixedR = { field: () => 0n, scalar: () => BigInt(v.r) };

describe("envelope parity with POC-2", () => {
  it("PK_operator of the vector is sk_operator · GRUMPKIN_G (standard generator)", () => {
    expect(scalarMul(BigInt(v.skOperator), GRUMPKIN_G)).toEqual(pt(v.pkOperator));
  });

  it("encrypt matches POC-2 vector (R and the 3 ciphertexts)", () => {
    const secrets = { price: BigInt(v.price), blinding: BigInt(v.blinding), nullifierSeed: BigInt(v.nullifierSeed) };
    const { envelope, r } = encryptEnvelope(secrets, pt(v.pkOperator), fixedR);
    expect(r.expose()).toBe(BigInt(v.r));
    expect(envelope.rPoint).toEqual(pt(v.rPoint));
    expect(envelope.ctPrice).toBe(BigInt(v.ctPrice));
    expect(envelope.ctBlinding).toBe(BigInt(v.ctBlinding));
    expect(envelope.ctSeed).toBe(BigInt(v.ctSeed));
  });
});
