# ADR-020 — Settlement and refunds are automated per-bid, not manually pulled

## Context
ADR-007 chose pull-based refunds specifically to avoid an O(N) settlement loop, a single stuck recipient blocking everyone else, and settlement cost growing with participant count. The intended user experience is that nobody should have to manually click anything to receive a payout, a quota, or a refund after an auction resolves.

## Decision
Keep every per-bid outcome (payment of a filled amount, refund of an unfilled amount, or both together for a partially-filled bid) behind a single, permissionless, idempotent entry point scoped to one `bid_index` at a time — preserving ADR-007's core property that no single call can loop over or block on other participants.

Layer automatic execution on top of that entry point: immediately after a market reaches `FINALIZED`, the platform's own automation calls this entry point once for every accepted bid, without requiring the bidder or the seller to take any action. Because the entry point itself remains permissionless and idempotent, this automation is a convenience, not a trust dependency — if it fails or is delayed for any reason, anyone (the participant themselves, or any other party) can still call the same entry point directly, and calling it twice for the same bid is a no-op the second time.

## Consequences
Pros:
- matches the "nothing to claim manually" experience without reintroducing O(N) settlement risk;
- automation failure degrades to "still callable by anyone," never to "funds stuck" — consistent with the existing liveness guarantees (ADR-016);
- a partially-filled bid's payment and refund legs settle together in one call, rather than needing separate payment and refund mechanisms.

Cons:
- the platform now runs an additional piece of automation (a keeper) whose only job is calling this entry point after finalization; its downtime affects UX latency, never fund safety.

## Forbidden
Do not make the automation itself a trusted dependency for correctness or fund safety — the underlying entry point must remain safe to call by anyone, at any time after finalization, any number of times.

## Update — mechanism and the operator dependency (, ADR-023)
The mechanism is specified in ADR-023:
- one transaction per bid;
- a settlement-binding proof;
- refund via `confidential_transfer_from(to = bidder)`.

**The "never a trust dependency" claim above is narrowed.** The entry point remains permissionless and idempotent, so a *keeper* outage only delays settlement. But every leg's payload carries a proof only the operator can build with `sk_op`, so an *operator* outage does stop automatic settlement. Funds are still never stuck: bidders can always use `revoke_spender`. This is the post-MVP case in OQ-15.
