# ADR-017 — UltraHonk over Noir (BN254/Grumpkin) replaces Groth16/BN254 as the proving system

## Context
ADR-002 targeted Groth16/BN254 pending a resource benchmark. Since then, the settlement/collateral path (RF-08, RF-09, RF-20, RF-21) has been redesigned to reuse Stellar's own Confidential Token rather than invent a custom collateral commitment. That token's account model is built on Pedersen commitments over the Grumpkin curve, proved in Noir and verified on-chain via UltraHonk. A `bid_validity` circuit that must open a Grumpkin-curve commitment to prove collateral linkage is native (cheap) arithmetic if it is itself written in Noir/UltraHonk over the BN254 scalar field, and foreign-field (expensive) arithmetic if it is a Groth16/BN254 circuit built around a different internal commitment scheme.

## Decision
Target UltraHonk over Noir, verified on Soroban via the native BN254 host functions (CAP-0074), for:
- `bid_validity`
- `winner_allocation` (the multi-unit allocation circuit, see ADR-019)

Use the same universal SRS Aztec's Barretenberg toolchain (`bb`) already publishes — no per-circuit trusted-setup ceremony.

## Consequences
Pros:
- native, cheap linkage to the Confidential Token's Grumpkin-based commitments;
- no per-circuit trusted setup, faster iteration while circuits are still changing;
- same toolchain (Noir) as the primitive being integrated with.

Cons:
- larger proof size than Groth16 (hundreds of field elements vs. a handful of group elements);
- less mature reference tooling on Soroban as of this writing (unaudited reference verifiers only);
- resource cost on Soroban must still be benchmarked against this project's actual circuits — this ADR does not mark that benchmark resolved.

## Gate
This ADR does not mark the proof-verification resource budget resolved. `plans/001-ultrahonk-spike.md` must benchmark the real verifier path for this project's actual circuits before any production commitment.

## Forbidden
Do not migrate proving systems again without new benchmark evidence and a new ADR. Do not assume UltraHonk's reported community resource numbers apply to this project's specific circuits without independent measurement.
