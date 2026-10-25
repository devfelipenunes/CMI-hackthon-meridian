# RF-14 — Validar Bid

## Dependencies
- RF-03
- RF-05
- RF-06
- RF-09
- RF-13
- RF-15

## Blockers
Practical completion depends on blocked dependencies.

## Goal
Apply bid checks in cheap-to-expensive fail-fast order.

## Validation Order
Cheap to expensive; nothing is written before step 12. There is one Auction Contract per market (ADR-022), so "market exists" is implied by the call.
1. state == `OPEN` and current ledger < `close_ledger`
2. bidder auth
3. `bid_count < MAX_BIDS` (8, ADR-024 D17)
4. bidder registered
5. bidder has no accepted bid (ADR-008)
6. `requested_quantity > 0`
7. nullifier unused
8. eligibility still valid (a no-op under the default `None` policy)
9. the bidder holds a trustline for the quota asset (ADR-024 D18)
10. the delegation exists (`is_spender`) and `live_until_ledger ≥ finalize_by_ledger + settlement_margin` (RF-09); `C_a` is read from the token
11. ZK proof (`bid_validity`), which also proves collateral linkage and envelope consistency (OQ-01)
12. state mutation

## Must
- return typed errors
- create no partial state on failure

## Must Not
- run expensive verifier before cheap deterministic checks
- mutate bid count before success

## Acceptance Criteria
- each major failure path tested
- no state delta after any failure
- validation order is observable in unit structure or documented helper sequence

## Related Files
- `contracts/auction/src/bid.rs`
- `contracts/auction/src/errors.rs`
- `tests/bid_validation.rs`

## Definition of Done
- [ ] validation matrix tested
