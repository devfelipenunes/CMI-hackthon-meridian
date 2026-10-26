import {
  DOMAIN as TOKEN_DOMAIN,
  H,
  commit,
  deriveAllowR,
  deriveSpendR,
  dvkFromVkOp,
  ecdh as ecdhX,
  encryptBalance,
  fieldIn,
  frAdd,
  pointIn,
  scalarMul as ctdScalarMul,
  spongeSqueeze2,
} from "@ctd/sdk";

import { fromCtd, toCtd } from "../curve/grumpkin.js";
import type { Point } from "../field/encoding.js";
import { toField, type Field } from "../field/field.js";
import { cryptoRng, type Rng } from "../ports/rng.js";
import type { NoirInputs } from "../proving/prover.js";
import { Secret } from "../secret.js";
import { encodeData, fieldVal, pointVal } from "./codec.js";
import type { TokenKeys } from "./keys.js";
import type { Opening } from "./setSpender.js";

export interface RevokeSpenderParams {
  keys: TokenKeys;
  spend: Secret<Opening>;

  opI: Field;

  allowance: Secret<{ vA: bigint; sigmaA: Field }>;
  kAudS: Point;
}

export interface RevokeSpenderPayload {
  cSpendNew: Point;
  bTilde: Field;
  rE: Point;
  sigma: Field;
  vAudS: Field;
  bAudS: Field;
}

export interface RevokeSpenderWitness {
  inputs: NoirInputs;
  payload: RevokeSpenderPayload;
  next: Secret<Opening>;
}

export function buildRevokeSpenderWitness(p: RevokeSpenderParams, rng: Rng = cryptoRng): RevokeSpenderWitness {
  const spend = p.spend.expose();
  const { vA, sigmaA } = p.allowance.expose();
  if (vA < 0n) throw new RangeError("vA must be ≥ 0");
  const vk = p.keys.vk.expose();
  const opI = toField(p.opI);
  const kAudS = toCtd(p.kAudS);
  const vNew = spend.v + vA;
  const sigma = rng.scalar();
  const rE = rng.scalar();

  const dvk = dvkFromVkOp(vk, opI);
  const rA = deriveAllowR(dvk, sigmaA);
  const rNew = deriveSpendR(vk, sigma);
  const cSpendNew = commit(vNew, rNew);
  const bTilde = encryptBalance(vNew, vk, sigma);
  const rePoint = ctdScalarMul(rE, H);
  const [mV, mB] = spongeSqueeze2(TOKEN_DOMAIN.AUDITOR_SENDER, ecdhX(rE, kAudS), sigma);
  const vAudS = frAdd(vA, mV);
  const bAudS = frAdd(vNew, mB);

  const inputs: NoirInputs = {
    sk: fieldIn(p.keys.sk.expose()),
    v_a: fieldIn(vA),
    r_a: fieldIn(rA),
    v_s: fieldIn(spend.v),
    r_s: fieldIn(spend.r),
    r_e: fieldIn(rE),
    ...pointIn("c_spend", commit(spend.v, spend.r)),
    ...pointIn("c_a", commit(vA, rA)),
    sigma_a: fieldIn(sigmaA),
    ...pointIn("y", toCtd(p.keys.Y)),
    op_i: fieldIn(opI),
    addr_f: fieldIn(p.keys.addrF),
    ...pointIn("k_aud_s", kAudS),
    ...pointIn("c_spend_new", cSpendNew),
    b_tilde: fieldIn(bTilde),
    sigma: fieldIn(sigma),
    ...pointIn("r_e", rePoint),
    v_tilde_aud_s: fieldIn(vAudS),
    b_tilde_aud_s: fieldIn(bAudS),
  };

  return {
    inputs,
    payload: { cSpendNew: fromCtd(cSpendNew), bTilde, rE: fromCtd(rePoint), sigma, vAudS, bAudS },
    next: new Secret({ v: vNew, r: rNew }),
  };
}

export function encodeRevokeSpenderData(w: RevokeSpenderWitness, proof: Uint8Array): Uint8Array {
  const p = w.payload;
  return encodeData(
    {
      c_spend_new: pointVal(p.cSpendNew),
      b_tilde: fieldVal(p.bTilde),
      r_e: pointVal(p.rE),
      sigma: fieldVal(p.sigma),
      v_aud_s: fieldVal(p.vAudS),
      b_aud_s: fieldVal(p.bAudS),
    },
    proof,
  );
}
