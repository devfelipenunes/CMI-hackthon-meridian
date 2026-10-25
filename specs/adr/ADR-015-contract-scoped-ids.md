# ADR-015 — Contract-scoped numeric IDs

## Decision

Use:

- `market_id: u64` — contract-scoped monotonically increasing ID;
- `participant_id: u32` — market-scoped monotonically increasing ID;
- `bid_index: u32` — market-scoped accepted-bid order.

## Reason

Avoid ambiguous or expensive Stellar Address → ZK field conversions.

The contract maps participant IDs to addresses.

## Consequence

Proofs bind numeric IDs while authorization and settlement continue to use Stellar addresses.

## Update — `market_id` is now Factory-assigned, not contract-local

Per ADR-022, each Auction Contract instance serves exactly one market — there is no longer a "next market" to count within a single contract. `market_id` is now a **platform-wide** monotonically increasing `u64`, allocated once by the Market Factory at deployment time and passed into the Auction Contract's constructor as immutable config. The reasoning for using a compact numeric ID instead of an Address-derived one is unchanged; only *where* the counter lives has changed. `participant_id` and `bid_index` are unaffected — they remain scoped to a single market, which is now equivalent to being scoped to a single Auction Contract instance.
