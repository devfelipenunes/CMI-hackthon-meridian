import { describe, expect, it } from "vitest";

import {
  FR_MODULUS,
  fromBytes32BE,
  hashLimbs,
  pointFromBytes,
  pointToBytes,
  toBytes32BE,
  toField,
  u32Field,
  u64Field,
} from "../../src/index.js";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("toField", () => {
  it("rejects value ≥ modulus (no silent reduction)", () => {
    expect(() => toField(FR_MODULUS)).toThrow(RangeError);
    expect(() => toField(FR_MODULUS + 5n)).toThrow(RangeError);
  });

  it("rejects negative values", () => {
    expect(() => toField(-1n)).toThrow(RangeError);
  });

  it("accepts the edges 0 and r − 1", () => {
    expect(toField(0n)).toBe(0n);
    expect(toField(FR_MODULUS - 1n)).toBe(FR_MODULUS - 1n);
  });
});

describe("u32Field and u64Field", () => {
  it("u64Field is 32-byte big-endian (same case as u64_field_is_32_bytes_big_endian)", () => {
    const b = u64Field(0x0102_0304_0506_0708n);
    expect(b.length).toBe(32);
    expect([...b.slice(0, 24)]).toEqual(new Array(24).fill(0));
    expect([...b.slice(24)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("u32Field is 32-byte big-endian with the value in the last 4 bytes", () => {
    const b = u32Field(0x0a0b0c0d);
    expect(b.length).toBe(32);
    expect([...b.slice(0, 28)]).toEqual(new Array(28).fill(0));
    expect([...b.slice(28)]).toEqual([0x0a, 0x0b, 0x0c, 0x0d]);
  });

  it.each([-1, 2 ** 32, 1.5, Number.NaN])("u32Field rejects %s", (v) => {
    expect(() => u32Field(v)).toThrow(RangeError);
  });

  it.each([-1n, 1n << 64n])("u64Field rejects %s", (v) => {
    expect(() => u64Field(v)).toThrow(RangeError);
  });

  it("u64Field accepts 2^64 − 1 and 2^63 − 1", () => {
    expect(hex(u64Field((1n << 64n) - 1n)).slice(48)).toBe("ffffffffffffffff");
    expect(fromBytes32BE(u64Field((1n << 63n) - 1n))).toBe((1n << 63n) - 1n);
  });
});

describe("toBytes32BE and fromBytes32BE", () => {
  it.each([0n, 1n, (1n << 63n) - 1n, (1n << 64n) - 1n, FR_MODULUS - 1n])("round trip %s", (v) => {
    const b = toBytes32BE(v);
    expect(b.length).toBe(32);
    expect(fromBytes32BE(b)).toBe(v);
  });

  it("fromBytes32BE rejects a length other than 32", () => {
    expect(() => fromBytes32BE(new Uint8Array(31))).toThrow(RangeError);
  });
});

describe("points", () => {
  const p = { x: 0x0102n, y: 0x0304n };

  it("pointToBytes is be(x) ‖ be(y), x first (point_fields_splits_x_then_y)", () => {
    const b = pointToBytes(p);
    expect(b.length).toBe(64);
    expect(fromBytes32BE(b.slice(0, 32))).toBe(0x0102n);
    expect(fromBytes32BE(b.slice(32))).toBe(0x0304n);
  });

  it("identity (0, 0) is all zeros", () => {
    expect([...pointToBytes({ x: 0n, y: 0n })]).toEqual(new Array(64).fill(0));
  });

  it("pointFromBytes(pointToBytes(p)) == p", () => {
    expect(pointFromBytes(pointToBytes(p))).toEqual(p);
  });

  it("pointFromBytes rejects a length other than 64", () => {
    expect(() => pointFromBytes(new Uint8Array(63))).toThrow(RangeError);
  });

  it("pointFromBytes rejects a coordinate ≥ modulus", () => {
    const b = new Uint8Array(64).fill(0xff);
    expect(() => pointFromBytes(b)).toThrow(RangeError);
  });
});

describe("hashLimbs", () => {
  const h = Uint8Array.from({ length: 32 }, (_, i) => i);

  it("hi is first 16 bytes, lo is last 16 (hash_limbs_hi_is_first_16_bytes)", () => {
    const { lo, hi } = hashLimbs(h);
    expect(hi).toBe(0x000102030405060708090a0b0c0d0e0fn);
    expect(lo).toBe(0x101112131415161718191a1b1c1d1e1fn);
  });

  it("each limb fits in 128 bits", () => {
    const { lo, hi } = hashLimbs(new Uint8Array(32).fill(0xff));
    expect(lo).toBe((1n << 128n) - 1n);
    expect(hi).toBe((1n << 128n) - 1n);
  });

  it("rejects a length other than 32", () => {
    expect(() => hashLimbs(new Uint8Array(33))).toThrow(RangeError);
  });
});
