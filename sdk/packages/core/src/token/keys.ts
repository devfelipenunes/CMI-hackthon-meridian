import { deriveKeys, type KeyPair } from "@ctd/sdk";

import { fromCtd } from "../curve/grumpkin.js";
import type { Point } from "../field/encoding.js";
import { toField, type Field } from "../field/field.js";
import { cryptoRng, type Rng } from "../ports/rng.js";
import { Secret } from "../secret.js";

export interface TokenKeys {
  sk: Secret<Field>;
  vk: Secret<Field>;
  Y: Point;
  PVK: Point;
  addrF: Field;
}

export function deriveTokenKeys(sk: Field, tokenAddrF: Field): TokenKeys {
  if (toField(sk) === 0n) throw new RangeError("sk must be in [1, r)");
  const k = deriveKeys(sk, toField(tokenAddrF));
  return { sk: new Secret(k.sk), vk: new Secret(k.vk), Y: fromCtd(k.Y), PVK: fromCtd(k.PVK), addrF: k.addrF };
}

export function generateTokenKeys(tokenAddrF: Field, rng: Rng = cryptoRng): TokenKeys {
  return deriveTokenKeys(rng.scalar(), tokenAddrF);
}

export function toCtdKeyPair(keys: TokenKeys): KeyPair {
  return deriveKeys(keys.sk.expose(), keys.addrF);
}
