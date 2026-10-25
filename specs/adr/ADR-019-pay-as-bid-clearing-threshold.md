# ADR-019 — Multi-unit pay-as-bid allocation via clearing-price threshold, FCFS rationing at the margin

## Context
ADR-014 fixed a single-winner tie-break rule ("highest bid, lowest index on exact tie") for a winner-take-all design. The protocol now sells a fixed number of quotas across potentially many simultaneous winners, at each winner's own bid price (pay-as-bid / discriminatory pricing, first-price sealed-bid), not a single clearing price paid by everyone.

## Decision
Each bid states a price per quota (private) and a requested quantity (public). At close:
1. accepted bids are ordered by price, descending;
2. quotas are allocated in that order, accumulating requested quantity, until the total quota supply is exhausted;
3. every bid strictly above the resulting clearing price is filled in full;
4. every bid strictly below the clearing price is filled with zero quotas;
5. among bids exactly at the clearing price, quotas are allocated in ascending `bid_index` order (first accepted, first served) until supply runs out; the last such bid may be partially filled.

Each filled bid (in full or in part) pays its own stated price for the quantity it actually receives — there is no single price paid by all winners. If total requested quantity across all accepted bids is below total supply, every bid fills in full and the clearing price equals the reserve (minimum price per quota) — this is a degenerate case of the same rule, not a separate cancellation path.

Because every leaf in the canonical root (ADR-005) already corresponds to a bid that passed `bid_validity`, the allocation circuit does not need to re-check reserve or collateral — it only needs to prove the clearing threshold and resulting allocation are consistent with the real, canonical set of bids and their public requested quantities.

## Consequences
Pros:
- a per-bid threshold comparison against a single private clearing value is asymptotically cheaper to prove than a full sort/ranking circuit;
- reuses the existing canonical-root machinery (ADR-005) without modification to the commitment/leaf layout — `quantity` is tracked as public per-bid contract state alongside the leaf, not inside the leaf hash itself;
- the tie-break sub-rule (lowest index wins among equals) carries over unchanged from ADR-014, just applied at the margin instead of to a single winner.

Cons:
- the allocation circuit's public inputs and constraints are materially different from a simple argmax circuit and need their own benchmark (see `plans/004`);
- undersubscription must be tested explicitly as the degenerate case above, not assumed to work by analogy.

## Forbidden
Do not reintroduce a single uniform clearing price paid by every winner (that would be a different auction format — uniform-price, not pay-as-bid) without a new ADR. Do not let the operator choose the clearing threshold arbitrarily — it must be the unique value implied by the real bid set and total supply, and the allocation proof must fail if it is not.
