import { addressToField, buildRegisterWitness, deriveTokenKeys, encodeRegisterData, type Prover, type Signer, type TokenPort } from "@zolvency-cmi/core";

import type { Secret } from "@zolvency-cmi/core";

export async function registerFeeWallet(d: {
  token: TokenPort;
  tokenAddress: string;
  auditorId: number;
  prover: Prover;
  signer: Signer;
  tokenSk: Secret<bigint>;
}): Promise<{ registered: boolean; tx: string | null }> {
  if ((await d.token.account(d.signer.address)) !== null) return { registered: false, tx: null };
  const keys = deriveTokenKeys(d.tokenSk.expose(), addressToField(d.tokenAddress));
  const w = buildRegisterWitness(keys);
  const { proof } = await d.prover.prove("register", w.inputs);
  const r = await d.token.register(d.signer, d.auditorId, encodeRegisterData(w, proof));
  return { registered: true, tx: r.hash };
}
