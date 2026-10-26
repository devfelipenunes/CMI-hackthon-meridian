import type { OnChainDelegation, SetSpenderWitness } from "../../src/index.js";

export function delegationFrom(w: SetSpenderWitness, liveUntilLedger = 1_000_000): OnChainDelegation {
  return {
    allowanceCommitment: w.payload.cA,
    encryptedAllowance: w.payload.aTilde,
    escrowedDvk: w.payload.escrowedDvk,
    allowanceSalt: w.payload.sigmaA,
    liveUntilLedger,
  };
}
