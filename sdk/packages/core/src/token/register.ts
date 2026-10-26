import { buildRegisterWitness as ctdBuildRegister, encodeRegisterData as ctdEncodeRegisterData } from "@ctd/sdk";

import { fromCtd, toCtd } from "../curve/grumpkin.js";
import type { Point } from "../field/encoding.js";
import type { NoirInputs } from "../proving/prover.js";
import { toCtdKeyPair, type TokenKeys } from "./keys.js";

export interface RegisterWitness {
  inputs: NoirInputs;

  payload: { y: Point; pvk: Point };
}

export function buildRegisterWitness(keys: TokenKeys): RegisterWitness {
  const w = ctdBuildRegister(toCtdKeyPair(keys));
  return { inputs: w.inputs, payload: { y: fromCtd(w.payload.y), pvk: fromCtd(w.payload.pvk) } };
}

export function encodeRegisterData(w: RegisterWitness, proof: Uint8Array): Uint8Array {
  const ctdWitness = { inputs: w.inputs as Record<string, string>, payload: { y: toCtd(w.payload.y), pvk: toCtd(w.payload.pvk) } };
  return new Uint8Array(ctdEncodeRegisterData(ctdWitness, proof).bytes());
}
