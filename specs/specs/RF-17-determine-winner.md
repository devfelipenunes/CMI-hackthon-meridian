# RF-17 — Determinar Alocação (Preço de Corte)

## Dependencies
- RF-16

## Blockers
None. The design was validated in PLAN-004 (REVIEW); this RF is implementation work.

## Goal
Compute the multi-unit, pay-as-bid allocation from valid private openings: which accepted bids receive quotas, and how many.

## Rule (ADR-019)
1. order accepted bids by `price`, descending;
2. allocate `requested_quantity` in that order until `total_quotas` is exhausted;
3. every bid strictly above the resulting clearing price fills in full;
4. every bid strictly below it fills with zero;
5. bids exactly at the clearing price are filled in ascending `bid_index` order (first accepted, first served) until supply runs out — the last such bid may be partially filled;
6. if total requested quantity is below `total_quotas`, every bid fills in full (the degenerate, undersubscribed case).

## Inputs
- canonical accepted `BidRecord`s, including public `requested_quantity`
- usable private openings for every accepted bid

## Output
- `filled_quantities[bid_index]` for every accepted bid
- the private `clearing_price` value
- witness material for RF-18

## Must
- verify each opening reproduces its accepted commitment before proving
- preserve canonical bid index order
- include every accepted bid in the computation — none may be silently skipped

## Must Not
- silently skip an accepted bid
- use a different rationing rule at the margin than ascending `bid_index`
- allocate more than `requested_quantity` to any bid, or more than `total_quotas` in aggregate

## Acceptance Criteria
- deterministic result
- FCFS margin rationing tested with a genuine partial fill
- undersubscription degenerate case tested
- invalid opening detected before proof generation

## Related Files
- `operator/src/allocation.rs`
- `operator/src/envelope.rs`
- `tests/operator_allocation.rs`

## Definition of Done
- [ ] all accepted bids included
- [ ] deterministic test vectors, including a partial-fill case
