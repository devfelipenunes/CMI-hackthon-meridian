import { Grumpkin, H as CTD_H, G as CTD_G, scalarMul as ctdScalarMul, type Point as CtdPoint } from "@ctd/sdk";

import { toField } from "../field/field.js";
import type { Point } from "../field/encoding.js";

const IDENTITY: Point = Object.freeze({ x: 0n, y: 0n });

export function toCtd(p: Point): CtdPoint {
  if (p.x === 0n && p.y === 0n) return Grumpkin.ZERO;
  try {
    const q = Grumpkin.fromAffine({ x: toField(p.x), y: toField(p.y) });
    q.assertValidity();
    return q;
  } catch {
    throw new RangeError("point is not on the Grumpkin curve");
  }
}

export function fromCtd(q: CtdPoint): Point {
  if (q.is0()) return IDENTITY;
  const { x, y } = q.toAffine();
  return Object.freeze({ x, y });
}

export const TOKEN_G: Point = fromCtd(CTD_G);
export const TOKEN_H: Point = fromCtd(CTD_H);

export const GRUMPKIN_G: Point = Object.freeze({ x: 1n, y: 0x02cf135e7506a45d632d270d45f1181294833fc48d823f272cn });

export function scalarMul(k: bigint, p: Point): Point {
  return fromCtd(ctdScalarMul(toField(k), toCtd(p)));
}

export function pointAdd(a: Point, b: Point): Point {
  return fromCtd(toCtd(a).add(toCtd(b)));
}

export function pedersenCommit(value: bigint, randomness: bigint): Point {
  return pointAdd(scalarMul(value, TOKEN_G), scalarMul(randomness, TOKEN_H));
}

export function ecdh(sk: bigint, pub: Point): Point {
  const s = scalarMul(sk, pub);
  if (s.x === 0n && s.y === 0n) throw new RangeError("ecdh produced the identity (degenerate key)");
  return s;
}
