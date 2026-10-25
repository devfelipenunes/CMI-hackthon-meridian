# RF-16 — Encerrar Mercado

## Dependencies
- RF-03
- RF-11

## Blockers
None. OQ-04 is resolved: the root is recomputed at close as one standard Poseidon2 hash over the 8 padded leaves (ADR-025). OQ-09 is resolved.

## Goal
Permissionlessly freeze the accepted-bid set (commitments and their public `requested_quantity`) after the configured close ledger.

## Preconditions
```text
state == OPEN
ledger.sequence() >= close_ledger
```

## State Changes
- freeze `bid_count` and the `requested_quantity` array
- finalize canonical commitment root
- set `finalize_by_ledger = close_ledger + finalization_grace_ledgers`
- if `bid_count == 0`: cancel instead
- otherwise `OPEN -> CLOSED`, **regardless of how total requested quantity compares to `total_quotas`** — undersubscription is not a cancellation trigger (ADR-019's degenerate case)

## Must
- be permissionless
- deterministically freeze root and quantities
- reject any later bid

## Must Not
- let caller choose root
- let caller choose finalization timeout
- cancel a market solely because total requested quantity is below `total_quotas`

## Acceptance Criteria
- cannot close early
- anyone can close on/after deadline
- zero-bid market cancels instead of closing
- an undersubscribed market with at least one accepted bid still closes normally
- root and quantities immutable after close
- later bid rejected

## Related Files
- `contracts/auction/src/market.rs`
- `contracts/auction/src/bid.rs`
- `contracts/auction/src/storage.rs`
- `tests/close_market.rs`

## Definition of Done
- [ ] close/cancel branches tested
- [ ] canonical root and quantities frozen
- [ ] undersubscription-does-not-cancel path tested
