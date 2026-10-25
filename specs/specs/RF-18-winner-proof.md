# RF-18 — Provar Alocação

## Dependencies
- RF-13
- RF-16
- RF-17

## Blockers
None. The design was validated in PLAN-004 (REVIEW). OQ-03, OQ-04 and OQ-09 are resolved.

## Goal
Prove that a claimed allocation (`filled_quantities` per `bid_index`) is exactly the one implied by the real, canonical accepted-bid set under the clearing-price rule (ADR-019) — not a single-winner proof.

## Private Witness
- prices
- blindings
- nullifier seeds
- participant IDs
- the clearing price

## Public Inputs
- canonical root
- `requested_quantity` per bid (already public)
- `filled_quantities` per bid (the claimed allocation output)
- bid count
- total supply (`total_quotas`)
- market ID
- auction rule
- config hash limbs

## Must Prove
- every active opening reconstructs the corresponding commitment
- every active leaf reconstructs the canonical tree
- every padded leaf equals `EMPTY_LEAF`, with `requested_quantity` and `filled_quantities` both zero at padded positions
- `filled_quantities[i] <= requested_quantities[i]` for every active bid
- every bid strictly above the clearing price fills in full; every bid strictly below fills with zero
- bids at the clearing price are filled in ascending `bid_index` order until supply is exhausted
- `sum(filled_quantities) == min(total_quotas, sum(requested_quantities))`

## Must Not
- reintroduce the minimum price per quota as an allocation-proof input (already enforced by `bid_validity`)
- trust an operator-supplied root, clearing price, or allocation without proving it against the real bid set
- expose any bid price

## Acceptance Criteria
- correct allocation verifies
- wrong allocation fails
- wrong root fails
- wrong padding fails
- wrong margin rationing fails
- undersubscription degenerate case verifies
- bid price absent from public inputs

## Related Files
- `circuits/winner_allocation/`
- `contracts/auction-verifier/src/lib.rs`
- `contracts/auction/src/settlement.rs`
- `tests/winner_allocation/`

## Definition of Done
- [x] 3-bid proof green, including a genuine partial fill — and re-validated at the production 8-bid scale (`POC/poc-4-clearing-price-allocation`, `POC/results/SUMMARY.md`)
- [x] `MAX_BIDS` scaling benchmarked before increasing (ADR-013) — measured and satisfied at `MAX_BIDS=8` (`ADR-013`'s update)

## Production notes (ADR-025)
- Use the **full** bid commitment (6 inputs, RF-10). POC-4 used a simplified two-field form.
- Leaves and root use the standard Poseidon2 sponge, with `EMPTY_LEAF = 999999` padding up to 8.
