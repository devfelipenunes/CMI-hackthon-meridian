import {
  DOMAIN as TOKEN_DOMAIN,
  H,
  commit,
  deriveAllowR,
  deriveTxBlind,
  ecdh as ecdhX,
  encryptAllowance,
  encryptAmount,
  fieldIn,
  frAdd,
  pointIn,
  scalarMul as ctdScalarMul,
  spongeSqueeze2,
} from "@ctd/sdk";
import { xdr } from "@stellar/stellar-sdk";

import { fromCtd, toCtd } from "../curve/grumpkin.js";
import { fromBytes32BE, pointFromBytes, type Point } from "../field/encoding.js";
import type { Field } from "../field/field.js";
import { cryptoRng, type Rng } from "../ports/rng.js";
import type { NoirInputs } from "../proving/prover.js";
import { Secret } from "../secret.js";
import { encodeData, fieldVal, pointVal } from "./codec.js";
import type { AllowanceState } from "./delegation.js";

export interface SpenderTransferParams {

  skOp: Secret<Field>;
  yOp: Point;

  allowance: Secret<AllowanceState>;
  vTx: bigint;
  pvkRecipient: Point;
  kAudR: Point;

  kAudS: Point;
}

export interface SpenderTransferPayload {
  cANew: Point;
  cTx: Point;
  rE: Point;
  vTilde: Field;
  aTildeNew: Field;
  sigmaANew: Field;
  vAudR: Field;
  rAudR: Field;
  vAudS: Field;
  aAudS: Field;
}

export interface SpenderTransferWitness {
  inputs: NoirInputs;
  payload: SpenderTransferPayload;

  recipientView: Secret<{ vTx: bigint; rTx: Field; cTx: Point }>;

  next: Secret<AllowanceState>;
}

export function buildSpenderTransferWitness(p: SpenderTransferParams, rng: Rng = cryptoRng): SpenderTransferWitness {
  const { dvk, vA, sigmaA } = p.allowance.expose();
  if (p.vTx < 0n || p.vTx > vA) throw new RangeError("vTx must be in [0, allowance]");
  const vANew = vA - p.vTx;
  const rE = rng.scalar();
  let sigmaANew = rng.scalar();
  while (sigmaANew === sigmaA) sigmaANew = rng.scalar();

  const yOp = toCtd(p.yOp);
  const pvkRecipient = toCtd(p.pvkRecipient);
  const kAudR = toCtd(p.kAudR);
  const kAudS = toCtd(p.kAudS);

  const rA = deriveAllowR(dvk, sigmaA);
  const cA = commit(vA, rA);
  const rePoint = ctdScalarMul(rE, H);
  const sX = ecdhX(rE, pvkRecipient);
  const rTx = deriveTxBlind(sX, sigmaA);
  const cTx = commit(p.vTx, rTx);
  const vTilde = encryptAmount(p.vTx, sX, sigmaA);
  const rANew = deriveAllowR(dvk, sigmaANew);
  const cANew = commit(vANew, rANew);
  const aTildeNew = encryptAllowance(vANew, dvk, sigmaANew);
  const [mVr, mRr] = spongeSqueeze2(TOKEN_DOMAIN.AUDITOR_RECIPIENT, ecdhX(rE, kAudR), sigmaA);
  const [mVs, mAs] = spongeSqueeze2(TOKEN_DOMAIN.AUDITOR_SENDER, ecdhX(rE, kAudS), sigmaA);
  const vAudR = frAdd(p.vTx, mVr);
  const rAudR = frAdd(rTx, mRr);
  const vAudS = frAdd(p.vTx, mVs);
  const aAudS = frAdd(vANew, mAs);

  const inputs: NoirInputs = {
    sk_op: fieldIn(p.skOp.expose()),
    dvk_i: fieldIn(dvk),
    v_a: fieldIn(vA),
    r_a: fieldIn(rA),
    v_tx: fieldIn(p.vTx),
    r_e: fieldIn(rE),
    ...pointIn("c_a", cA),
    sigma_a: fieldIn(sigmaA),
    ...pointIn("y_op", yOp),
    ...pointIn("pvk_recipient", pvkRecipient),
    ...pointIn("k_aud_r", kAudR),
    ...pointIn("k_aud_s", kAudS),
    ...pointIn("c_a_new", cANew),
    ...pointIn("c_tx", cTx),
    ...pointIn("r_e", rePoint),
    v_tilde: fieldIn(vTilde),
    a_tilde_new: fieldIn(aTildeNew),
    sigma_a_new: fieldIn(sigmaANew),
    v_tilde_aud_r: fieldIn(vAudR),
    r_tilde_aud_r: fieldIn(rAudR),
    v_tilde_aud_s: fieldIn(vAudS),
    a_tilde_aud_s: fieldIn(aAudS),
  };

  return {
    inputs,
    payload: { cANew: fromCtd(cANew), cTx: fromCtd(cTx), rE: fromCtd(rePoint), vTilde, aTildeNew, sigmaANew, vAudR, rAudR, vAudS, aAudS },
    recipientView: new Secret({ vTx: p.vTx, rTx, cTx: fromCtd(cTx) }),
    next: new Secret({ dvk, vA: vANew, rA: rANew, sigmaA: sigmaANew }),
  };
}

const FIELDS: Array<[keyof SpenderTransferPayload, string, "point" | "field"]> = [
  ["cANew", "c_a_new", "point"],
  ["cTx", "c_tx", "point"],
  ["rE", "r_e", "point"],
  ["vTilde", "v_tilde", "field"],
  ["aTildeNew", "a_tilde_new", "field"],
  ["sigmaANew", "sigma_a_new", "field"],
  ["vAudR", "v_aud_r", "field"],
  ["rAudR", "r_aud_r", "field"],
  ["vAudS", "v_aud_s", "field"],
  ["aAudS", "a_aud_s", "field"],
];

export function encodeSpenderTransferData(w: SpenderTransferWitness, proof: Uint8Array): Uint8Array {
  const payload: Record<string, xdr.ScVal> = {};
  for (const [key, wire, kind] of FIELDS) {
    const v = w.payload[key];
    payload[wire] = kind === "point" ? pointVal(v as Point) : fieldVal(v as bigint);
  }
  return encodeData(payload, proof);
}

export function decodeSpenderTransferData(data: Uint8Array): { payload: SpenderTransferPayload; proof: Uint8Array } {
  try {
    const top = new Map(xdr.ScVal.fromXDR(Buffer.from(data)).map()!.map((e) => [e.key().sym().toString(), e.val()]));
    const fields = new Map(top.get("payload")!.map()!.map((e) => [e.key().sym().toString(), new Uint8Array(e.val().bytes())]));
    const payload = {} as Record<keyof SpenderTransferPayload, unknown>;
    for (const [key, wire, kind] of FIELDS) {
      const bytes = fields.get(wire);
      if (!bytes) throw new Error(`missing ${wire}`);
      payload[key] = kind === "point" ? pointFromBytes(bytes) : fromBytes32BE(bytes);
    }
    return { payload: payload as SpenderTransferPayload, proof: new Uint8Array(top.get("proof")!.bytes()) };
  } catch {
    throw new RangeError("data is not a SpenderTransferData XDR");
  }
}
