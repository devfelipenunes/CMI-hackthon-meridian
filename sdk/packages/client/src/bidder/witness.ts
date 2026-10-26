import {
  BID_VALIDITY_PUBLIC_INPUTS,
  bidCommitment,
  bidNullifier,
  bidValidityPublicInputs,
  type BidEnvelope,
  type BidSecrets,
  type Field,
  type NoirInputs,
  type Point,
  type Secret,
} from "@zolvency-cmi/core";

export interface BidValidityParams {
  secrets: Secret<BidSecrets>;
  marketId: bigint;
  participantId: number;
  requestedQuantity: number;
  minPricePerQuota: bigint;

  collateral: { cA: Point; rA: Secret<Field> };
  envelope: BidEnvelope;

  r: Secret<bigint>;
  configHash: Uint8Array;
}

export interface BidValidityWitness {

  inputs: NoirInputs;

  publicInputs: Uint8Array[];
  commitment: Field;
  nullifier: Field;
}

const hex = (b: Uint8Array): string => `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
const fieldHex = (v: bigint): string => `0x${v.toString(16).padStart(64, "0")}`;

export function buildBidValidityWitness(p: BidValidityParams): BidValidityWitness {
  const s = p.secrets.expose();
  const commitment = bidCommitment({ ...s, marketId: p.marketId, participantId: p.participantId });
  const nullifier = bidNullifier(s.nullifierSeed, p.marketId, p.participantId);
  const publicInputs = bidValidityPublicInputs({
    commitment,
    nullifier,
    marketId: p.marketId,
    participantId: p.participantId,
    requestedQuantity: p.requestedQuantity,
    minPricePerQuota: p.minPricePerQuota,
    collateralBinding: p.collateral.cA,
    envelope: p.envelope,
    configHash: p.configHash,
  });
  const inputs: NoirInputs = Object.fromEntries(BID_VALIDITY_PUBLIC_INPUTS.map((name, i) => [name, hex(publicInputs[i]!)]));
  inputs.price = fieldHex(s.price);
  inputs.blinding = fieldHex(s.blinding);
  inputs.nullifier_seed = fieldHex(s.nullifierSeed);
  inputs.collateral_randomness = fieldHex(p.collateral.rA.expose());
  inputs.r = fieldHex(p.r.expose());
  return { inputs, publicInputs, commitment, nullifier };
}
