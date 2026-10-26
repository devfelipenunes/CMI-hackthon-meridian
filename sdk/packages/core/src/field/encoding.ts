import { toField, type Field } from "./field.js";

export interface Point {
  readonly x: Field;
  readonly y: Field;
}

const U64_MAX = (1n << 64n) - 1n;

export function toBytes32BE(v: bigint): Uint8Array {
  if (v < 0n || v >= 1n << 256n) throw new RangeError("value does not fit in 32 bytes");
  const out = new Uint8Array(32);
  let x = v;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

export function fromBytes32BE(b: Uint8Array): bigint {
  if (b.length !== 32) throw new RangeError(`expected 32 bytes, got ${b.length}`);
  let v = 0n;
  for (const byte of b) v = (v << 8n) | BigInt(byte);
  return v;
}

export function u32Field(v: number): Uint8Array {
  if (!Number.isInteger(v) || v < 0 || v > 0xffff_ffff) throw new RangeError("value is not a u32");
  return toBytes32BE(BigInt(v));
}

export function u64Field(v: bigint): Uint8Array {
  if (v < 0n || v > U64_MAX) throw new RangeError("value is not a u64");
  return toBytes32BE(v);
}

export function pointToBytes(p: Point): Uint8Array {
  const out = new Uint8Array(64);
  out.set(toBytes32BE(toField(p.x)), 0);
  out.set(toBytes32BE(toField(p.y)), 32);
  return out;
}

export function pointFromBytes(b: Uint8Array): Point {
  if (b.length !== 64) throw new RangeError(`expected 64 bytes, got ${b.length}`);
  return { x: toField(fromBytes32BE(b.slice(0, 32))), y: toField(fromBytes32BE(b.slice(32))) };
}

export function hashLimbs(h: Uint8Array): { lo: Field; hi: Field } {
  if (h.length !== 32) throw new RangeError(`expected 32 bytes, got ${h.length}`);
  const limb = (bytes: Uint8Array) => bytes.reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
  return { hi: limb(h.slice(0, 16)), lo: limb(h.slice(16)) };
}
