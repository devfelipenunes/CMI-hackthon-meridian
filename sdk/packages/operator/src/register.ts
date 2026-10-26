import { addressToField, buildRegisterWitness, deriveTokenKeys, encodeRegisterData, type Prover, type Scalar, type Secret } from "@zolvency-cmi/core";

export async function buildRegisterData(p: { spenderKey: Secret<Scalar>; tokenAddress: string; prover: Prover }): Promise<Uint8Array> {
  const keys = deriveTokenKeys(p.spenderKey.expose(), addressToField(p.tokenAddress));
  const w = buildRegisterWitness(keys);
  const { proof } = await p.prover.prove("register", w.inputs);
  return encodeRegisterData(w, proof);
}
