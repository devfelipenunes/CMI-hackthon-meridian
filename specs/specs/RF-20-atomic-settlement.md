# RF-20 — Liquidar um Lance Aceito (Settlement Atômico por Bid)

## Dependencies
- RF-07
- RF-08
- RF-09
- RF-19

## Blockers
None. The design is frozen in ADR-023 and validated live in `POC/poc-6-atomic-settlement` (OQ-06 and OQ-13 resolved).

## Goal
For one accepted `bid_index`, atomically deliver whatever quota quantity it was allocated, collect its exact confidential payment for that quantity, and refund any unconsumed collateral — in a single permissionless, idempotent call (ADR-020). This is the entry point the platform's automation calls once per accepted bid (RF-21); it must also work correctly if called manually or by any other party.

## Preconditions
- `state == FINALIZED`, or `state == CANCELLED` after a finalization timeout (ADR-016). In a `CANCELLED` market nothing was allocated: every bid has `filled = 0`, and the call is the full refund
- the target `bid_index` exists and has not already been settled
- the bid is not `FAILED`: a bid already closed through `release_unsettled` cannot be settled (`BidAlreadyClosed`)
- `filled_quantities[bid_index]` is known from the stored allocation (`0` for every bid in a `CANCELLED` market)

## State Changes
For the given `bid_index`, with `filled = filled_quantities[bid_index]` and `unfilled = requested_quantity[bid_index] - filled`:
- if `filled > 0`: confidential payment `price × filled − fee` — winner's locked allowance → seller, via `confidential_transfer_from`; house fee `fee = floor(price × filled × 1000 / 10000)` → platform fee wallet, via `confidential_transfer_from` (ADR-026); quota asset: `filled` units, escrow → bidder
- if `unfilled > 0`: confidential refund `price × unfilled` — remaining allowance → bidder, via `confidential_transfer_from(spender = auction, from = bidder, to = bidder)` (ADR-023; `revoke_spender` needs the bidder's own proof and signature)
- before any leg: verify the settlement-binding proof over (bid commitment, requested, filled, `fee_bps`, `c_seller`, `c_fee`, `c_refund`), with the three points decoded from the three SpenderTransfer payloads (ADR-023, ADR-026; validated in `POC/poc-6-atomic-settlement`, 348.8M of 400M CPU)
- mark this `bid_index` as settled (idempotency guard)

## Failure path: `release_unsettled(bid_index)` (ADR-024 D13)
- permissionless; `state == FINALIZED` or `state == CANCELLED`; bid neither `SETTLED` nor `FAILED`; `token.is_spender(bidder, auction) == false` (revoked or expired)
- transfer the bid's `filled_quantity` quota units back to the seller (none in a `CANCELLED` market, where `filled = 0`); mark the bid `FAILED`
- a second call on a closed bid is an error (`BidAlreadyClosed`), unlike a repeated `settle` (see Must): the decision was already made, and accepting it again would pay a second reimbursement for the same work

## End of the market
- the market ends when no bid is left open (every bid is `SETTLED` or `FAILED`), whichever entry point closed the last one
- at that point the remaining seller fee reserve returns to the seller (ADR-024 D15) and a market-settled event is emitted (RF-22)
- a `FINALIZED` market moves to `SETTLED`. A `CANCELLED` market **stays** `CANCELLED`: it is terminal (RF-03), and no new transition is added

## Update — cancelled markets
Until this update, `release_unsettled` required `FINALIZED`. In a market cancelled by timeout, a bidder who revoked (or whose lock expired) before the refund `settle` ran leaves a bid that neither entry point can close: `settle` has no delegation to spend from, and `release_unsettled` refused the state. The market's open-bid count then never reaches zero, and the rest of the seller's fee reserve stays in the contract forever. Nothing else is trapped: the quota units already returned at cancellation, and the bidder's collateral is theirs through `revoke_spender`. Allowing `release_unsettled` in `CANCELLED` closes that bid as `FAILED` with no quota movement, so the market can end and the reserve can return. See the ADR-024 update of the same date.

## Must
- be callable by anyone, not only the bidder or the seller
- be a no-op (not an error) if this `bid_index` was already settled
- consume exactly the allocated amount — never more than what `set_spender` originally locked
- rely on Soroban's atomic rollback: all legs for this one bid succeed together or none do
- publish no payment or refund amount

## Must Not
- charge any fee other than the fixed 10% house fee bound by the settlement proof (network fees are paid from the seller's reserve, ADR-024 D11/D15)
- settle using a clear-value fallback and call this RF complete
- loop over every accepted bid in a single call — this is strictly per-`bid_index`
- allow a second, non-idempotent settlement of the same bid to move funds twice

## Acceptance Criteria
- a fully filled bid pays the seller in full and refunds nothing
- a zero-filled bid refunds the full locked amount and pays nothing
- a partially filled bid pays the seller for the filled portion and refunds the rest, in the same call
- calling this entry point twice for the same `bid_index` is safe and moves funds only once
- failure in any leg reverts the whole call for that bid, without affecting any other bid
- public state/events do not reveal any amount
- in a `CANCELLED` market, `settle` refunds the full locked amount (`filled = 0`), and a bid whose delegation is gone closes through `release_unsettled` without moving any quota
- once the last open bid closes, the remaining fee reserve returns to the seller, in a `FINALIZED` market (which becomes `SETTLED`) and in a `CANCELLED` one (which stays `CANCELLED`)

## Related Files
- `contracts/auction/src/settlement.rs`
- `contracts/auction/src/escrow.rs`
- `integrations/confidential-token/`
- `tests/settlement.rs`

## Definition of Done
- [ ] real confidential token path tested for full, partial, and zero fills
- [ ] idempotency tested
- [ ] rollback tests
