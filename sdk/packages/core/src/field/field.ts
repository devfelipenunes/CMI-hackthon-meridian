
export const FR_MODULUS = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;

export type Field = bigint;

export type Scalar = bigint;

export function toField(v: bigint): Field {
  if (v < 0n || v >= FR_MODULUS) throw new RangeError("value is not a field element (expected 0 ≤ v < r)");
  return v;
}
