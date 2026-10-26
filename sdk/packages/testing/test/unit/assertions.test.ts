import { describe, expect, it } from "vitest";

import { Secret } from "@zolvency-cmi/core";

import { MemoryLogger, assertNoSecretLeak } from "../../src/index.js";

const PRICE = 650_123_457n;
const HEX = PRICE.toString(16);

describe("assertNoSecretLeak", () => {
  it("passes when no sink contains the secret", () => {
    expect(() => assertNoSecretLeak([PRICE], ["bid accepted", { bidIndex: 3 }, new Error("x")])).not.toThrow();
  });

  it.each([
    ["decimal in a string", `price=${PRICE}`],
    ["hex with 0x", `value 0x${HEX}`],
    ["hex without 0x, uppercase", `v=${HEX.toUpperCase()}`],
    ["32-byte padded hex", HEX.padStart(64, "0")],
    ["bigint in an object", { nested: { deep: [PRICE] } }],
    ["32-byte big-endian Uint8Array", { bytes: be32(PRICE) }],
    ["error message", new Error(`bad price ${PRICE}`)],
    ["error cause", new Error("wrapped", { cause: new Error(`inner ${PRICE}`) })],
  ])("finds the secret as %s", (_label, sink) => {
    expect(() => assertNoSecretLeak([PRICE], [sink])).toThrow(/secret #0/);
  });

  it("finds the secret in a MemoryLogger", () => {
    const log = new MemoryLogger();
    log.info("prepared", { price: PRICE });
    expect(() => assertNoSecretLeak([PRICE], [log])).toThrow(/secret #0/);
  });

  it("a Secret wrapper keeps the value out", () => {
    expect(() => assertNoSecretLeak([PRICE], [{ price: new Secret(PRICE) }])).not.toThrow();
  });

  it("the failure message never prints the secret itself", () => {
    try {
      assertNoSecretLeak([PRICE], [`${PRICE}`]);
    } catch (e) {
      expect(String(e)).not.toContain(PRICE.toString());
      return;
    }
    throw new Error("expected a failure");
  });

  it("rejects secrets too short to be searched safely", () => {
    expect(() => assertNoSecretLeak([7n], ["anything"])).toThrow(/too short/);
  });
});

function be32(v: bigint): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}
