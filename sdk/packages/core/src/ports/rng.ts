import { FR_MODULUS } from "../field/field.js";

export interface Rng {
  field(): bigint;
  scalar(): bigint;
}

export function sampleField(next32: () => Uint8Array): bigint {
  for (;;) {
    const bytes = next32();
    bytes[0] = bytes[0]! & 0x3f;
    let v = 0n;
    for (const b of bytes) v = (v << 8n) | BigInt(b);
    if (v < FR_MODULUS) return v;
  }
}

export function sampleScalar(next32: () => Uint8Array): bigint {
  for (;;) {
    const v = sampleField(next32);
    if (v !== 0n) return v;
  }
}

function random32(): Uint8Array {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export const cryptoRng: Rng = {
  field: () => sampleField(random32),
  scalar: () => sampleScalar(random32),
};
