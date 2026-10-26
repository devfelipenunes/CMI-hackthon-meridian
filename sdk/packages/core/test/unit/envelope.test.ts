import { describe, expect, it } from "vitest";

import {
  DOMAIN,
  FR_MODULUS,
  GRUMPKIN_G,
  Secret,
  decryptEnvelope,
  ecdh,
  encryptEnvelope,
  poseidon2Hash,
  scalarMul,
} from "../../src/index.js";

const SK_OP = 0x0abc_def0_1234_5678_9abc_def0n;
const PK_OP = scalarMul(SK_OP, GRUMPKIN_G);
const SECRETS = { price: 650_123_457n, blinding: 0x1111_2222_3333_4444n, nullifierSeed: 0x5555_6666_7777_8888n };

function seq(...scalars: bigint[]) {
  let i = 0;
  return { field: () => 0n, scalar: () => scalars[i++]! };
}

describe("encryptEnvelope / decryptEnvelope (ADR-004)", () => {
  it("decrypt(encrypt(s)) == s", () => {
    const { envelope } = encryptEnvelope(SECRETS, PK_OP, seq(0x9999_8888_7777n));
    expect(decryptEnvelope(envelope, SK_OP).expose()).toEqual(SECRETS);
  });

  it("decrypt with another key does not recover the price", () => {
    const { envelope } = encryptEnvelope(SECRETS, PK_OP, seq(0x9999_8888_7777n));
    expect(decryptEnvelope(envelope, SK_OP + 1n).expose().price).not.toBe(SECRETS.price);
  });

  it("mask uses domain 1002 with index 0, 1, 2 over the full shared point", () => {
    const { envelope } = encryptEnvelope(SECRETS, PK_OP, seq(0x9999_8888_7777n));
    const s = ecdh(SK_OP, envelope.rPoint);
    const mask = (i: bigint) => poseidon2Hash([DOMAIN.BID_ENVELOPE_MASK, s.x, s.y, i]);
    const add = (a: bigint, b: bigint) => (a + b) % FR_MODULUS;
    expect(envelope.ctPrice).toBe(add(SECRETS.price, mask(0n)));
    expect(envelope.ctBlinding).toBe(add(SECRETS.blinding, mask(1n)));
    expect(envelope.ctSeed).toBe(add(SECRETS.nullifierSeed, mask(2n)));
  });

  it("R is r · GRUMPKIN_G (standard generator), and r is returned as Secret", () => {
    const { envelope, r } = encryptEnvelope(SECRETS, PK_OP, seq(77_777n));
    expect(r).toBeInstanceOf(Secret);
    expect(envelope.rPoint).toEqual(scalarMul(77_777n, GRUMPKIN_G));
  });

  it("each encryption uses a fresh r from the Rng", () => {
    const rng = seq(1_000_001n, 1_000_002n);
    const a = encryptEnvelope(SECRETS, PK_OP, rng).envelope;
    const b = encryptEnvelope(SECRETS, PK_OP, rng).envelope;
    expect(a.ctPrice).not.toBe(b.ctPrice);
  });

  it("the envelope serializes without any secret", () => {
    const { envelope, r } = encryptEnvelope(SECRETS, PK_OP, seq(0x9999_8888_7777n));
    const json = JSON.stringify({ envelope, r }, (_k, val) => (typeof val === "bigint" ? val.toString(16) : val));
    for (const secret of [SECRETS.price, SECRETS.blinding, SECRETS.nullifierSeed, 0x9999_8888_7777n]) {
      expect(json).not.toContain(secret.toString(16));
    }
  });

  it("rejects a price out of range before encrypting", () => {
    expect(() => encryptEnvelope({ ...SECRETS, price: 0n }, PK_OP, seq(5n))).toThrow(RangeError);
  });

  it("rejects an invalid operator key (identity or off-curve)", () => {
    expect(() => encryptEnvelope(SECRETS, { x: 0n, y: 0n }, seq(5n))).toThrow(RangeError);
    expect(() => encryptEnvelope(SECRETS, { x: 1n, y: 2n }, seq(5n))).toThrow(RangeError);
  });
});
