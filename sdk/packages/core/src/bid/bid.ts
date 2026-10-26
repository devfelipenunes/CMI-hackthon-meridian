import { toField, type Field } from "../field/field.js";
import { DOMAIN, EMPTY_LEAF, MAX_BIDS } from "../hash/domains.js";
import { poseidon2Hash } from "../hash/poseidon2.js";
import { cryptoRng, type Rng } from "../ports/rng.js";
import { Secret } from "../secret.js";

export interface BidSecrets {
  price: bigint;
  blinding: Field;
  nullifierSeed: Field;
}

export interface BidOpening extends BidSecrets {
  marketId: bigint;
  participantId: number;
}

const PRICE_LIMIT = 1n << 63n;
const U64_LIMIT = 1n << 64n;

export function assertPriceRange(price: bigint): void {
  if (price <= 0n || price >= PRICE_LIMIT) throw new RangeError("price out of range (expected 0 < price < 2^63)");
}

function u64(v: bigint, name: string): Field {
  if (v < 0n || v >= U64_LIMIT) throw new RangeError(`${name} is not a u64`);
  return v;
}

function u32(v: number, name: string): Field {
  if (!Number.isInteger(v) || v < 0 || v > 0xffff_ffff) throw new RangeError(`${name} is not a u32`);
  return BigInt(v);
}

export function bidCommitment(o: BidOpening): Field {
  assertPriceRange(o.price);
  return poseidon2Hash([
    DOMAIN.BID_COMMIT,
    o.price,
    u64(o.marketId, "marketId"),
    u32(o.participantId, "participantId"),
    toField(o.blinding),
    toField(o.nullifierSeed),
  ]);
}

export function bidNullifier(nullifierSeed: Field, marketId: bigint, participantId: number): Field {
  return poseidon2Hash([
    DOMAIN.NULLIFIER,
    toField(nullifierSeed),
    u64(marketId, "marketId"),
    u32(participantId, "participantId"),
  ]);
}

export function bidLeaf(bidIndex: number, commitment: Field): Field {
  if (!Number.isInteger(bidIndex) || bidIndex < 0 || bidIndex >= MAX_BIDS) {
    throw new RangeError(`bidIndex must be in [0, ${MAX_BIDS})`);
  }
  return poseidon2Hash([DOMAIN.BID_LEAF, BigInt(bidIndex), toField(commitment)]);
}

export function commitmentsRoot(commitments: readonly Field[]): Field {
  if (commitments.length > MAX_BIDS) throw new RangeError(`at most ${MAX_BIDS} commitments`);
  const leaves = Array.from({ length: MAX_BIDS }, (_, i) =>
    i < commitments.length ? bidLeaf(i, commitments[i]!) : EMPTY_LEAF,
  );
  return poseidon2Hash(leaves);
}

export function newBidSecrets(price: bigint, rng: Rng = cryptoRng): Secret<BidSecrets> {
  assertPriceRange(price);
  return new Secret({ price, blinding: rng.field(), nullifierSeed: rng.field() });
}
