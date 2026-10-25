# RF-19 — Finalizar Mercado

## Dependencies
- RF-03
- RF-18

## Blockers
None of its own; it depends on RF-18. The unsold / unsettleable quota path was decided in ADR-024 D13 (OQ-16).

## Goal
Persist a cryptographically verified allocation, or permissionlessly cancel after the finalization timeout.

## Finalize Path
Preconditions:
- `state == CLOSED`
- current ledger <= allowed finalization window
- valid `winner_allocation` proof

State:
- store `filled_quantities` per `bid_index`
- return unsold quotas (`total_quotas − Σ filled`) to the seller (ADR-024 D13)
- `CLOSED -> FINALIZED`

## Timeout Cancel Path
Preconditions:
```text
state == CLOSED
ledger.sequence() > finalize_by_ledger
```

State:
- `CLOSED -> CANCELLED`
- asset becomes returnable to seller
- all locked participant collateral becomes releasable via the automated per-bid entry point (RF-20/RF-21)

## Must
- be permissionless: any caller holding a valid `winner_allocation` proof may finalize, not only a specific whitelisted "operator" address — the proof, not the caller's identity, is what authorizes the state change (ADR-021)
- never store any bid price or the clearing price
- store the allocation exactly as verified by the proof
- make timeout cancellation permissionless

## Must Not
- accept a second finalization
- allow the operator to extend the timeout

## Acceptance Criteria
- valid proof finalizes
- invalid proof fails
- timeout cancellation works
- cancellation before timeout fails
- allocation query resolves correct quantities per bidder

## Related Files
- `contracts/auction/src/settlement.rs`
- `contracts/auction/src/market.rs`
- `tests/finalization.rs`

## Definition of Done
- [ ] liveness escape path tested
