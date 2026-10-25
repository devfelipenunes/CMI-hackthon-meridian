# ADR-002 — Groth16 over BN254 for auction proofs

## Context
The auction needs compact, on-chain-verifiable proofs with predictable resource usage.

## Decision
Target Groth16/BN254 for:
- `bid_validity`
- `winner_proof`

## Consequences
Pros:
- compact proof format;
- appropriate target for native BN254 verification paths.

Cons:
- separate proving toolchain;
- final resource viability must be measured.

## Gate
This ADR does not mark OQ-03 resolved. PLAN-001 must benchmark the real verifier path.

## Forbidden
Do not migrate proving systems without benchmark evidence and a new ADR.
