# RF-02 — Identificar e Localizar Mercado

## Dependencies
None.

## Blockers
None.

## Goal
Provide a simple, collision-free, platform-wide identifier for markets, and a way to resolve that identifier to the Auction Contract instance that actually hosts the market. Since ADR-022 gives every market its own dedicated Auction Contract instance, this is no longer purely a per-contract counter — it is the Market Factory's responsibility.

## Decision
`market_id` is a **platform-wide** monotonically increasing `u64`, allocated by the Market Factory.

See `ADR-015` (numeric-ID rationale) and `ADR-022` (why the counter lives in the Factory, not in each Auction Contract instance).

## State Changes
On the **Factory**, at market creation (RF-01):
- read `next_market_id`
- assign it to the new market
- increment `next_market_id`
- record `market_id -> auction_contract_address` in the registry

On each **Auction Contract instance**:
- store the single `market_id` it received at construction; never allocate, increment, or overwrite it

## Must
- start from a documented initial value
- never reuse an ID, platform-wide
- fit directly into ZK field inputs
- let the Factory resolve any valid `market_id` to its Auction Contract address (`get_market_address(market_id)`)

## Must Not
- hash Stellar addresses to create the ID
- reuse deleted/cancelled/resolved IDs
- let an Auction Contract instance allocate an ID for itself, or for a second market

## Acceptance Criteria
- first two created markets get distinct sequential IDs, platform-wide (not just within one contract)
- cancelled market ID is not reused
- overflow path is explicitly handled
- `get_market_address` resolves a valid `market_id` to the correct instance and fails clearly for an unknown one
- an Auction Contract instance's own stored `market_id` matches what the Factory's registry has for it

## Related Files
- `contracts/market-factory/src/lib.rs`
- `contracts/market-factory/src/storage.rs`
- `contracts/auction/src/market.rs`
- `contracts/auction/src/storage.rs`
- `contracts/auction/src/types.rs`
- `tests/market_id.rs`
- `tests/market_factory.rs`

## Definition of Done
- [ ] sequential, platform-wide IDs tested
- [ ] overflow handling tested
- [ ] registry lookup tested (found and not-found cases)
- [ ] no address-to-field conversion introduced
