# RF-12 — Gerar Prova ZK de Validade do Bid

## Dependencies
- RF-04
- RF-09
- RF-10
- RF-15

## Blockers
None. OQ-01, OQ-02 and OQ-03 are resolved.

## Goal
Prove that the hidden bid price opens the submitted commitment, meets the minimum price per quota, and its declared collateral (`price × requested_quantity`) matches the real locked allowance in the Confidential Token.

## Private Witness
- `price`
- `blinding`
- `nullifier_seed`
- `collateral_randomness` (the Confidential Token allowance's Pedersen blinding, ADR-018)
- `r` (the envelope's ephemeral scalar, ADR-004 / OQ-01)

## Public Inputs
Frozen order, as in `docs/CRYPTO.md` (15 field elements; a Grumpkin point is two fields, `x` then `y`):
1. `commitment`
2. `nullifier`
3. `market_id`
4. `participant_id`
5. `requested_quantity`
6. `min_price_per_quota`
7. `collateral_binding` (x, y) — the Confidential Token's Grumpkin `C_a` for this bid
8. `r_point` (x, y) — the envelope's ephemeral point `R = r·G`
9. `ciphertext_price`
10. `ciphertext_blinding`
11. `ciphertext_seed`
12. `config_hash_lo`
13. `config_hash_hi`

`PK_operator` (the operator's envelope public key) is a circuit constant, not a public input (`docs/CRYPTO.md`).

## Must Prove
- commitment opening
- nullifier derivation
- `0 < price < 2^63`
- `price >= min_price_per_quota`
- `collateral_binding == (price × requested_quantity) · G + collateral_randomness · H`
- envelope consistency: `r_point == r · G` and the three ciphertexts mask the same `price`, `blinding`, `nullifier_seed` with `Poseidon2(1002, S.x, S.y, lane)`, `S = r · PK_operator` (constraints 6–10 of `docs/CRYPTO.md`)

## Must Not
- expose price
- accept `collateral_binding` as a caller-supplied value — the contract must read it from the Confidential Token's current on-chain allowance state for the bidder/Auction Contract pair (`docs/SECURITY.md` S6)
- use a mocked collateral binding in the final implementation
- reorder public inputs after verifier key generation

## Acceptance Criteria
- valid proof verifies
- wrong market fails
- wrong participant fails
- below minimum price fails
- mismatched collateral fails
- clear price absent from public inputs

## Related Files
- `circuits/bid_validity/`
- `contracts/auction-verifier/src/lib.rs`
- `tests/bid_validity/`

## Definition of Done
- [x] UltraHonk spike green (ADR-017, PLAN-001) — toolchain validated end to end, real proofs generated and verified on Soroban testnet (`POC/results/SUMMARY.md`)
- [x] collateral linkage resolved (PLAN-003) — validated live against the deployed token (POC-5)
- [ ] public-input test vectors frozen — the envelope and collateral constraint groups each have their own POC-level vectors (`POC/poc-2`, `POC/poc-3`); not yet frozen as this circuit's own merged, final vectors

## Additional constraints
- `price < 2^63`, the same bound as `settlement_binding` (ADR-023), so `price × requested_quantity < 2^127`.
- Hashes use the standard Poseidon2 sponge and the frozen domain table (ADR-025).
