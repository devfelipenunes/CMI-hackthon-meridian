import { createHash } from "node:crypto";

import { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { decodeBase64RegisterData, decodeRegisterData } from "../lib/register-data.js";

function struct(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  const entries = Object.keys(fields)
    .sort()
    .map((key) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val: fields[key]! }));
  return xdr.ScVal.scvMap(entries);
}

function registerData(y: Uint8Array, opts: { wrapped: boolean }): Uint8Array {
  const payload = struct({
    y: xdr.ScVal.scvBytes(Buffer.from(y)),
    pvk: xdr.ScVal.scvBytes(Buffer.alloc(64, 7)),
  });
  const envelope = struct({
    payload,
    proof: xdr.ScVal.scvBytes(Buffer.alloc(32, 9)),
  });
  const raw = envelope.toXDR();
  const value = opts.wrapped ? xdr.ScVal.scvBytes(raw).toXDR() : raw;
  return new Uint8Array(value);
}

describe("decodeRegisterData", () => {
  const y = Uint8Array.from({ length: 64 }, (_, i) => i + 1);
  const expected = createHash("sha256").update(y).digest("hex");

  it("reads Y from the raw struct emitted by encodeRegisterData", () => {
    expect(decodeRegisterData(registerData(y, { wrapped: false }))).toEqual({ operatorKeyId: expected, y });
  });

  it("accepts an operator export wrapped in Bytes", () => {
    expect(decodeRegisterData(registerData(y, { wrapped: true })).operatorKeyId).toBe(expected);
  });

  it("rejects bytes that are not XDR", () => {
    expect(() => decodeRegisterData(Uint8Array.of(1, 2, 3, 4))).toThrow(/XDR/);
  });

  it("rejects a struct without payload", () => {
    const envelope = struct({ proof: xdr.ScVal.scvBytes(Buffer.alloc(4)) });
    expect(() => decodeRegisterData(new Uint8Array(envelope.toXDR()))).toThrow(/payload/);
  });
});

describe("decodeBase64RegisterData", () => {
  it("decodes padded base64 and rejects other text", () => {
    expect([...decodeBase64RegisterData("AQID")]).toEqual([1, 2, 3]);
    expect(() => decodeBase64RegisterData("não é base64")).toThrow(/base64/);
  });
});
