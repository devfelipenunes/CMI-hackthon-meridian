import { DOMAIN as TOKEN_DOMAIN, deriveSpendR, deriveTxBlind, ecdh as ecdhX, fpAdd, frSub, poseidonWithDomain } from "@ctd/sdk";

import { pedersenCommit, toCtd } from "../curve/grumpkin.js";
import type { Point } from "../field/encoding.js";
import { toField, type Field } from "../field/field.js";
import { Secret } from "../secret.js";
import type { TokenKeys } from "./keys.js";
import type { Opening } from "./setSpender.js";

export function openSpendableBalance(
  ev: { bTilde: Field; sigma: Field; commitment?: Point },
  keys: TokenKeys,
): Secret<Opening> {
  const vk = keys.vk.expose();
  const sigma = toField(ev.sigma);
  const v = frSub(toField(ev.bTilde), poseidonWithDomain(TOKEN_DOMAIN.ENCRYPTED_BALANCE, [vk, sigma]));
  const r = deriveSpendR(vk, sigma);
  if (ev.commitment) {
    const c = pedersenCommit(v, r);
    if (c.x !== ev.commitment.x || c.y !== ev.commitment.y) throw new RangeError("opening does not match the on-chain commitment");
  }
  return new Secret({ v, r });
}

export function decryptIncomingTransfer(ev: { rE: Point; vTilde: Field; sigma: Field }, vk: Secret<Field>): Secret<{ vTx: bigint; rTx: Field }> {
  const s = ecdhX(vk.expose(), toCtd(ev.rE));
  const sigma = toField(ev.sigma);
  const vTx = frSub(toField(ev.vTilde), poseidonWithDomain(TOKEN_DOMAIN.TX_AMOUNT, [s, sigma]));
  return new Secret({ vTx, rTx: deriveTxBlind(s, sigma) });
}

export function addOpenings(a: Opening, b: Opening): Opening {
  return { v: a.v + b.v, r: fpAdd(a.r, b.r) };
}
