import type { BidSecrets } from "../bid/bid.js";
import { assertPriceRange } from "../bid/bid.js";
import { GRUMPKIN_G, ecdh, scalarMul } from "../curve/grumpkin.js";
import type { Point } from "../field/encoding.js";
import { FR_MODULUS, toField, type Field } from "../field/field.js";
import { DOMAIN } from "../hash/domains.js";
import { poseidon2Hash } from "../hash/poseidon2.js";
import { cryptoRng, type Rng } from "../ports/rng.js";
import { Secret } from "../secret.js";

export interface BidEnvelope {
  rPoint: Point;
  ctPrice: Field;
  ctBlinding: Field;
  ctSeed: Field;
}

const add = (a: bigint, b: bigint): Field => (a + b) % FR_MODULUS;
const sub = (a: bigint, b: bigint): Field => (((a - b) % FR_MODULUS) + FR_MODULUS) % FR_MODULUS;

function masks(s: Point): [Field, Field, Field] {
  const m = (i: bigint) => poseidon2Hash([DOMAIN.BID_ENVELOPE_MASK, s.x, s.y, i]);
  return [m(0n), m(1n), m(2n)];
}

export function encryptEnvelope(
  secrets: BidSecrets,
  pkOperator: Point,
  rng: Rng = cryptoRng,
): { envelope: BidEnvelope; r: Secret<bigint> } {
  assertPriceRange(secrets.price);
  const blinding = toField(secrets.blinding);
  const seed = toField(secrets.nullifierSeed);
  const r = rng.scalar();
  const s = ecdh(r, pkOperator);
  const [mPrice, mBlinding, mSeed] = masks(s);
  return {
    envelope: {
      rPoint: scalarMul(r, GRUMPKIN_G),
      ctPrice: add(secrets.price, mPrice),
      ctBlinding: add(blinding, mBlinding),
      ctSeed: add(seed, mSeed),
    },
    r: new Secret(r),
  };
}

export function decryptEnvelope(envelope: BidEnvelope, skEnvelope: bigint): Secret<BidSecrets> {
  const s = ecdh(skEnvelope, envelope.rPoint);
  const [mPrice, mBlinding, mSeed] = masks(s);
  return new Secret({
    price: sub(toField(envelope.ctPrice), mPrice),
    blinding: sub(toField(envelope.ctBlinding), mBlinding),
    nullifierSeed: sub(toField(envelope.ctSeed), mSeed),
  });
}
