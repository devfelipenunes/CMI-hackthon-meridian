import { DOMAIN as TOKEN_DOMAIN, Fr, Grumpkin, deriveAllowR, dvkFromVkOp, ecdh as ecdhX, frSub, poseidonWithDomain } from "@ctd/sdk";

import type { Point } from "../field/encoding.js";
import { toField, type Field } from "../field/field.js";
import { Secret } from "../secret.js";
import type { TokenKeys } from "./keys.js";

export interface OnChainDelegation {

  allowanceCommitment: Point;
  encryptedAllowance: Field;
  escrowedDvk: { rX: Field; cipher: Field };
  allowanceSalt: Field;

  liveUntilLedger: number;
}

export interface AllowanceState {
  dvk: Field;
  vA: bigint;
  rA: Field;
  sigmaA: Field;
}

function liftX(x: Field): ReturnType<typeof Grumpkin.fromAffine> {
  try {
    const y = Fr.sqrt(Fr.sub(Fr.mul(Fr.mul(x, x), x), 17n));
    return Grumpkin.fromAffine({ x, y });
  } catch {
    throw new RangeError("escrowed_dvk R_x is not on the Grumpkin curve");
  }
}

export function recoverDelegation(d: OnChainDelegation, skOp: Secret<Field>, spenderAddrF: Field): Secret<AllowanceState> {
  const sEsc = ecdhX(skOp.expose(), liftX(toField(d.escrowedDvk.rX)));
  const dvk = frSub(toField(d.escrowedDvk.cipher), poseidonWithDomain(TOKEN_DOMAIN.ESCROWED_DELEGATION_VIEWING_KEY, [sEsc, toField(spenderAddrF)]));
  return new Secret(allowanceFromDvk(d, dvk));
}

function allowanceFromDvk(d: OnChainDelegation, dvk: Field): AllowanceState {
  const sigmaA = toField(d.allowanceSalt);
  const vA = frSub(toField(d.encryptedAllowance), poseidonWithDomain(TOKEN_DOMAIN.ENCRYPTED_ALLOWANCE, [dvk, sigmaA]));
  return { dvk, vA, rA: deriveAllowR(dvk, sigmaA), sigmaA };
}

export function ownerAllowance(d: OnChainDelegation, keys: TokenKeys, spenderAddrF: Field): Secret<{ vA: bigint; sigmaA: Field }> {
  const a = allowanceFromDvk(d, dvkFromVkOp(keys.vk.expose(), toField(spenderAddrF)));
  return new Secret({ vA: a.vA, sigmaA: a.sigmaA });
}
