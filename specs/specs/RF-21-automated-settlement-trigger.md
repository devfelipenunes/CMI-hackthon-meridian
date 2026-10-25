# RF-21 — Disparar Liquidação Automática

## Dependencies
- RF-19
- RF-20

## Blockers
None of its own; it depends on RF-20. The operator-offline case is post-MVP (OQ-15).

## Goal
Give bidders and the seller a "nothing to claim manually" experience (ADR-020) by having the platform's own automation call RF-20's per-bid settlement entry point once for every accepted bid, immediately after a market reaches `FINALIZED` or `CANCELLED`.

## Behavior
- on `FINALIZED`: for every `bid_index` in the market, call RF-20's settlement entry point
- on `CANCELLED`: for every accepted `bid_index`, call the same entry point with `filled_quantities[bid_index] == 0` for all — an all-refund case
- this automation is a convenience layer only: RF-20's entry point remains independently safe to call by anyone, at any time after the market reaches a terminal-settlement-eligible state, any number of times

## MVP notes (ADR-023/ADR-024)
- every settlement leg (seller, house fee, refund) needs a payload built by the operator with `sk_op`, so "settleable by any other party" means *submittable* by anyone once the operator has produced it. Operator-offline settlement is post-MVP (OQ-15)
- the platform's submissions are funded from the seller's XLM fee reserve (ADR-024 D15)
- a bid whose delegation is gone is closed with `release_unsettled` instead of `settle` (RF-20), in a `FINALIZED` market and in a `CANCELLED` one alike; without it the market never ends and the seller's remaining fee reserve stays in the contract
- submit at most **one settlement per ledger**: a full settlement uses ~60% of a ledger's CPU budget (348.8M of 580M, ADR-026). A market with 8 winners takes at least ~8 ledgers (~40 s). Retry in a later ledger on resource contention.

## Must
- trigger without requiring the bidder or the seller to take any action
- never be a trust dependency — if the automation is delayed, stopped, or fails partway through, every not-yet-settled bid must still be settleable manually or by any other party via RF-20 directly
- treat a partial failure (some bids settled, others not yet) as a normal, safe intermediate state, not an error condition

## Must Not
- loop over all bids inside a single atomic contract call — each call to RF-20's entry point stays independently scoped, per ADR-020
- become a required step for correctness — the contract-level guarantees must hold with or without this automation running

## Acceptance Criteria
- every accepted bid is settled without any bidder or the seller manually calling anything, in the ordinary case
- disabling the automation does not break correctness — every bid remains settleable manually
- a partially-completed automation run (some bids settled, some not) does not corrupt state or block the remaining bids
- cancelled-market refunds work the same way as finalized-market settlement

## Related Files
- `contracts/auction/src/settlement.rs`
- `operator/src/settlement_trigger.rs`
- `tests/automated_settlement.rs`

## Definition of Done
- [ ] all terminal-state settlement/refund paths tested, both automated and manual
- [ ] automation-disabled fallback tested
