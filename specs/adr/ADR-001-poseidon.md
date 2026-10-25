# ADR-001 — Poseidon for proof-critical hashing

## Context
The protocol needs hash constructions that are efficient inside ZK circuits.

## Decision
Use Poseidon for:
- bid commitments;
- nullifiers;
- canonical bid leaves;
- proof-critical Merkle hashing.

Use explicit domain separators for every semantic use.

## Consequences
Pros:
- circuit-friendly;
- one proof-native hashing family.

Cons:
- may not be cheapest for ordinary non-proof application hashing.

## Forbidden
Do not reuse the same Poseidon preimage layout for different semantic purposes without a domain separator.
Do not replace proof-critical Poseidon constructions without a new ADR.

## Update — Poseidon2 / native host function
Soroban exposes a native Poseidon2 permutation host function; use it instead of a WASM implementation once contract code exists, for the same "use the platform's own primitive" reason as the proving-system choice in ADR-017. Fix and document the exact round parameters (full/partial rounds) used, since that number is itself a security assumption, not an implementation detail.

## Update — standard sponge and frozen domains
The sponge built on the Poseidon2 permutation is the Confidential Token's standard `lib.nr::sponge`, and the domain table is frozen (1001 commitment, 1002 envelope mask, 1003 leaf, 1004 nullifier, `EMPTY_LEAF = 999999`). Both are in ADR-025. Round parameters are those of Soroban's native Poseidon2 permutation (CAP-0075), the same permutation the Confidential Token relies on.
