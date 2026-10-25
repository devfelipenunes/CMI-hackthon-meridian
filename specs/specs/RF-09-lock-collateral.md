# RF-09 — Bloquear Collateral

## Dependencies
- RF-05
- RF-08

## Blockers
None. OQ-02 was resolved live in `POC/poc-5-live-confidential-token`.

## Goal
Lock exactly `price × requested_quantity` for a participant's bid, via the Confidential Token's `set_spender`, naming the Auction Contract as spender (ADR-018).

## Economic Rule
```text
locked_collateral_value == price × requested_quantity
```

## Inputs
- `requested_quantity` (public)
- `live_until_ledger` — the ledger at which the delegation this lock creates expires. Chosen by the bidder, but **must** cover the market's `finalize_by_ledger` plus a safety margin for settlement-automation latency, or the settlement payment can fail with `DelegationExpired` even though nothing malicious happened (ADR-018 update).
- the `set_spender` proof and payload, generated client-side by the bidder (this is a real ZK proof requirement of the Confidential Token itself, separate from and in addition to this repo's own `bid_validity` proof)

## Where the lock happens
`set_spender` is a function **of the Confidential Token**, called directly by the bidder with the bidder's own proof and signature (ADR-018, validated live in POC-5). The Auction Contract does not mediate it and has no "lock" entry point of its own: it reads the resulting delegation (`is_spender`, `get_spender_delegation`) when the bid is submitted (RF-11/RF-14).

**Required order on the client:** prove → `set_spender` → `submit_bid`. The client (SDK) generates the `bid_validity` proof **before** calling `set_spender`: the bidder can compute `C_a` in advance (it chooses the salt and knows its own `dvk`), and a below-minimum price cannot produce a proof, so no delegation is ever created for it. If a bid is rejected by the Auction Contract **after** the lock (for example, the market filled up or closed in the meantime), the delegation stays with the bidder, who recovers the funds with `revoke_spender`; resubmitting the same bid can reuse the existing delegation, while a different price needs `revoke_spender` and a new `set_spender`.

## State Changes
On the Confidential Token (bidder's own `set_spender` call):
- the escrowed allowance `C_a` for the (bidder, Auction Contract) pair

On the Auction Contract, at bid acceptance (RF-11):
- the accepted bid records the bidder's address, which is the reference used to re-read that allowance later (settlement, `release_unsettled`); no amount is stored

## Must
- require participant auth
- avoid clear amount storage/events
- prevent multiple collateral positions for one bid (one `set_spender` call per accepted bid, matching ADR-008's one-bid-per-participant rule) — note this is also enforced by the token itself: a second `set_spender` for the same (participant, Auction Contract) pair while one is already live fails with `DelegationAlreadyExists`
- read `C_a` and `live_until_ledger` from the token (`get_spender_delegation`) — never from the caller
- validate `live_until_ledger >= finalize_by_ledger + settlement_margin` before accepting the bid that depends on this lock, and reject the bid otherwise. The token itself accepts any value, even one in the past (POC-5 check 14.1), and after expiry even the automatic refund fails
- make the binding usable by `bid_validity` (ADR-018)

## Must Not
- use an unrelated commitment
- allow bid acceptance before the collateral linkage is proven
- assume `set_spender` is a bare authorized call — it carries its own proof and must be treated as a proving step, not a simple transfer-of-authorization

## Acceptance Criteria
- real confidential collateral locks via `set_spender`
- mismatch between `price × requested_quantity` and the locked amount fails
- a `live_until_ledger` that does not cover `finalize_by_ledger` (plus margin) makes the bid that depends on it be rejected at submission (the token itself accepts any value), not discovered as a failure at settlement time
- a fully or partially unfilled bid's unconsumed amount is refunded by the Auction Contract via `confidential_transfer_from(to = bidder)` in RF-20 (the bidder's own `revoke_spender` remains their fallback exit)
- a filled bid's amount can be consumed in settlement via `confidential_transfer_from`
- attempting a second lock for the same participant while one is already active fails with the token's own `DelegationAlreadyExists`. Because the lock is a direct call on the token, that error never reaches the Auction Contract: the client/SDK must surface it as a clear error (checked in the implementing repository's end-to-end test), and the contract's own equivalent is rejecting a second bid from the same participant (ADR-008)

## Related Files
- `contracts/auction/src/escrow.rs`
- `contracts/auction/src/storage.rs`
- `circuits/bid_validity/`
- `tests/collateral.rs`

## Definition of Done
- [ ] linkage is cryptographically tested
- [ ] no amount leakage
- [ ] `live_until_ledger` validation tested (rejects too-short values, accepts sufficient ones)
