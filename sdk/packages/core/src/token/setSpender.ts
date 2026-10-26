import {
  DOMAIN as TOKEN_DOMAIN,
  H,
  commit,
  deriveAllowR,
  deriveSpendR,
  dvkFromVkOp,
  ecdh as ecdhX,
  encryptAllowance,
  encryptBalance,
  encryptEscDvk,
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
import { encodeData, fieldVal, pairVal, pointVal } from "./codec.js";
import type { TokenKeys } from "./keys.js";

export interface Opening {
  v: bigint;
  r: Field;
}

export interface SetSpenderParams {
  keys: TokenKeys;

  spend: Secret<Opening>;

  vA: bigint;

  yOp: Point;

  opI: Field;

  kAudS: Point;
}

export interface SetSpenderPayload {
  cSpendNew: Point;
  cA: Point;

  escrowedDvk: { rX: Field; cipher: Field };
  bTilde: Field;
  aTilde: Field;
  rE: Point;
  sigma: Field;
  sigmaA: Field;
  vAudS: Field;
  bAudS: Field;
}

export interface SetSpenderWitness {
  inputs: NoirInputs;
  payload: SetSpenderPayload;

  delegation: Secret<{ dvk: Field; rA: Field; vA: bigint; sigmaA: Field }>;

  next: Secret<Opening>;
}

export function buildSetSpenderWitness(p: SetSpenderParams, rng: Rng = cryptoRng): SetSpenderWitness {
  const spend = p.spend.expose();
  if (p.vA <= 0n || p.vA > spend.v) throw new RangeError("vA must be in (0, spendable balance]");
  const sk = p.keys.sk.expose();
  const vk = p.keys.vk.expose();
  const opI = toField(p.opI);
  const yOp = toCtd(p.yOp);
  const kAudS = toCtd(p.kAudS);
  const vNew = spend.v - p.vA;

  const sigma = rng.scalar();
  const sigmaA = rng.scalar();
  const rEScalar = rng.scalar();

  const dvk = dvkFromVkOp(vk, opI);
  const rA = deriveAllowR(dvk, sigmaA);
  const cA = commit(p.vA, rA);
  const aTilde = encryptAllowance(p.vA, dvk, sigmaA);
  const rNew = deriveSpendR(vk, sigma);
  const cSpendNew = commit(vNew, rNew);
  const bTilde = encryptBalance(vNew, vk, sigma);
  const rEPoint = ctdScalarMul(rEScalar, H);
  const rX = rEPoint.toAffine().x;
  const sEsc = ecdhX(rEScalar, yOp);
  const cipher = encryptEscDvk(dvk, sEsc, opI);
  const sAsX = ecdhX(rEScalar, kAudS);
  const [mV, mB] = spongeSqueeze2(TOKEN_DOMAIN.AUDITOR_SENDER, sAsX, sigma);
  const vAudS = frAdd(p.vA, mV);
  const bAudS = frAdd(vNew, mB);

  const inputs: NoirInputs = {
    sk: fieldIn(sk),
    v: fieldIn(spend.v),
    r: fieldIn(spend.r),
    v_a: fieldIn(p.vA),
    r_e: fieldIn(rEScalar),
    ...pointIn("c_spend", commit(spend.v, spend.r)),
    ...pointIn("y", toCtd(p.keys.Y)),
    ...pointIn("y_op", yOp),
    op_i: fieldIn(opI),
    addr_f: fieldIn(p.keys.addrF),
    ...pointIn("k_aud_s", kAudS),
    ...pointIn("c_spend_new", cSpendNew),
    ...pointIn("c_a", cA),
    escrowed_dvk_r_x: fieldIn(rX),
    escrowed_dvk_cipher: fieldIn(cipher),
    b_tilde: fieldIn(bTilde),
    a_tilde: fieldIn(aTilde),
    sigma: fieldIn(sigma),
    sigma_a: fieldIn(sigmaA),
    ...pointIn("r_e", rEPoint),
    v_tilde_aud_s: fieldIn(vAudS),
    b_tilde_aud_s: fieldIn(bAudS),
  };

  return {
    inputs,
    payload: {
      cSpendNew: fromCtd(cSpendNew),
      cA: fromCtd(cA),
      escrowedDvk: { rX, cipher },
      bTilde,
      aTilde,
      rE: fromCtd(rEPoint),
      sigma,
      sigmaA,
      vAudS,
      bAudS,
    },
    delegation: new Secret({ dvk, rA, vA: p.vA, sigmaA }),
    next: new Secret({ v: vNew, r: rNew }),
  };
}

export function encodeSetSpenderData(w: SetSpenderWitness, proof: Uint8Array): Uint8Array {
  const p = w.payload;
  return encodeData(
    {
      c_spend_new: pointVal(p.cSpendNew),
      c_a: pointVal(p.cA),
      escrowed_dvk: pairVal(p.escrowedDvk.rX, p.escrowedDvk.cipher),
      b_tilde: fieldVal(p.bTilde),
      a_tilde: fieldVal(p.aTilde),
      r_e: pointVal(p.rE),
      sigma: fieldVal(p.sigma),
      sigma_a: fieldVal(p.sigmaA),
      v_aud_s: fieldVal(p.vAudS),
      b_aud_s: fieldVal(p.bAudS),
    },
    proof,
  );
}
