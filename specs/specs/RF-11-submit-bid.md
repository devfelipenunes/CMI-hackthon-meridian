# RF-11 — Submeter Bid Confidencial

## Dependencies
- RF-05
- RF-06
- RF-09
- RF-10
- RF-12
- RF-13
- RF-14
- RF-15

## Blockers
None. OQ-01 and OQ-02 are resolved; it depends on RF-09/RF-12 being implemented.

## Goal
Accept exactly one fully validated confidential bid per participant — a sealed price plus a public requested quantity — and add it to the canonical accepted-bid set.

## Payload
Target payload includes:
- `market_id`
- `commitment` (over `price` only, per RF-10)
- `requested_quantity` (public)
- `nullifier`
- `proof`
- envelope/ciphertext data as resolved by OQ-01

Trusted values such as participant ID and config hash should be reconstructed by the contract.

## State Changes
After all checks succeed:
- assign next `bid_index`
- persist `BidRecord`, including public `requested_quantity`
- consume nullifier
- increment `bid_count`
- update/store data required for the canonical root
- emit price-free bid event (quantity may be included, since it is public)

## Must
- enforce `bid_count < MAX_BIDS`
- reject after `close_ledger`
- require bidder auth
- require registration
- revalidate eligibility (a no-op under the default `None` policy)
- reject a second accepted bid from the same participant
- verify envelope consistency per resolved OQ-01
- verify the `bid_validity` ZK proof (including the collateral-linkage constraint, ADR-018) before state mutation

## Must Not
- store clear bid price
- accept caller-declared participant ID without matching address mapping
- accept caller-supplied `collateral_binding` instead of reading the Confidential Token's own allowance state (`docs/SECURITY.md` S6)
- accept a bid beyond `MAX_BIDS` capacity
- accept a `requested_quantity` of zero
- accept a bid priced below `min_price_per_quota` under any circumstance, including "accept now, exclude during allocation" — this is enforced as a hard `bid_validity` proof constraint (RF-12), not a later filtering step: a below-minimum bid cannot produce a valid proof at all, so `submit_bid` fails atomically with no state mutation, exactly like any other invalid-proof case (checkpointed, confirmed as the intended behavior, not open for reinterpretation as a "silent exclusion" design)

## Acceptance Criteria
- valid bid accepted
- invalid proof rejected atomically
- a bid below `min_price_per_quota` is rejected atomically at submission (no `BidRecord` persisted, no nullifier consumed, participant free to resubmit) — not accepted and excluded later during allocation. No collateral is locked for it because the client generates the `bid_validity` proof before calling `set_spender`, and a below-minimum price cannot produce a proof (RF-09, "Required order on the client")
- malformed/inconsistent envelope rejected according to chosen design
- duplicate participant rejected
- max capacity enforced
- event contains no private price

## Related Files
- `contracts/auction/src/bid.rs`
- `contracts/auction/src/storage.rs`
- `contracts/auction/src/events.rs`
- `operator/`
- `tests/submit_bid.rs`

## Definition of Done
- [x] OQ-01 resolved (`POC/poc-2-envelope-consistency`)
- [x] OQ-02 resolved (live, POC-5)
- [ ] all fail-fast paths tested

## MVP rule (ADR-024 D18)
- reject the bid if the bidder has no trustline for the quota asset. For example, read `quota.balance(bidder)`, which fails without one; otherwise that bid could never settle.
