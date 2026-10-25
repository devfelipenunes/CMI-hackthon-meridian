# RF-01 — Criar Mercado

## Dependencies
- RF-02
- RF-03

## Blockers
None.

## Goal
Allow an authenticated seller to create a new multi-unit quota market with immutable-by-open configuration. Per ADR-022, "creating a market" is a two-part action: the platform-wide **Market Factory** allocates the `market_id` and deploys a fresh **Auction Contract** instance dedicated to that one market; that instance's own constructor then applies the config below.

## Inputs
- `asset: Address` — the fungible quota token being sold
- `total_quotas` — total number of quotas offered (the fixed supply the allocation rule, ADR-019, sells into)
- `min_price_per_quota`
- `close_ledger: u32/u64`
- `eligibility_policy: Option<Address>` — defaults to `None` (no verification required); see ADR-011; out of the MVP (ADR-024 D9)
- `fee_reserve: i128` — XLM deposited by the seller to pay the platform's close/finalize/settle submissions; the remainder is refunded at the end (ADR-024 D15)
- not seller-configurable: the house fee (`FEE_BPS = 1000`, 10%) and the platform fee wallet are platform constants set by the Factory (ADR-026, D21/D22)
- also not seller-configurable, and therefore not inputs: the Confidential Token used for collateral and settlement (a shared, platform-wide contract, ADR-018; not redeployed per market), the verifier instances, and `finalization_grace_ledgers` (the platform value of 2 days, ADR-024 D7). The Factory copies them into each Auction Contract's immutable config

## Preconditions
- seller authenticated
- `total_quotas > 0`
- `min_price_per_quota > 0`
- `close_ledger` is in the future
- the finalization grace is the platform constant of 2 days (ADR-024 D7); it is not a seller input
- `close_ledger − current ledger ≤ 30 days` (ADR-024 D7)
- the fee reserve is transferred in the same call
- the quota asset does not have clawback enabled (ADR-024 D18; platform-side check at creation, on-chain if the SAC allows it)
- `total_quotas` is expressed in whole asset units: 1 quota = 10^7 base units (ADR-024 D18)
- the seller is a registered account on the platform's Confidential Token, and so is the platform fee wallet (ADR-024 D22). Both receive a confidential leg in every settlement, refunds included (RF-20, D-08), and the token rejects a leg to an unregistered account. The Factory checks both before allocating a `market_id`: `SellerNotRegistered` / `FeeWalletNotRegistered`

## State Changes
On the **Factory**:
- allocate the next platform-wide `market_id` (RF-02)
- deploy a new Auction Contract instance from the already-uploaded WASM hash, passing it `market_id` and the config above
- record `market_id -> auction_contract_address` in the Factory's registry

On the newly deployed **Auction Contract instance**, at construction:
- store `market_id` (received from the Factory, immutable thereafter — the instance never allocates or increments it itself)
- persist seller/config
- set `state = CREATED`

## Must
- emit `market_created` (from the Factory, carrying `market_id` and the new instance's address; the instance itself may also emit its own construction event)
- keep config mutable only while still `CREATED` if any config-update method is later added
- include timeout fields in config hash at open

## Must Not
- transfer the asset yet
- auto-open the market
- accept bids
- assume external policy interfaces
- accept an operator key or operator configuration as part of market config — the operator is fixed platform infrastructure (ADR-021), not seller-configurable
- let the Auction Contract instance allocate its own `market_id`, or serve a second market later (ADR-022)

## Acceptance Criteria
- valid config creates exactly one market, backed by exactly one freshly deployed Auction Contract instance
- invalid quota count fails
- invalid close ledger fails
- a seller without a Confidential Token account fails, and so does a platform whose fee wallet has none; neither allocates a `market_id` nor deploys anything
- market ID increments deterministically and is globally unique across the whole platform, not just within one contract
- the Factory's registry resolves `market_id` to the correct instance address
- event emitted
- no asset/collateral is moved

## Related Files
- `contracts/market-factory/src/lib.rs`
- `contracts/auction/src/market.rs`
- `contracts/auction/src/types.rs`
- `contracts/auction/src/events.rs`
- `contracts/auction/src/errors.rs`
- `tests/market.rs`
- `tests/market_factory.rs`

## Definition of Done
- [ ] implementation
- [ ] positive tests
- [ ] negative tests
- [ ] typed errors
- [ ] no unrelated state mutation
- [ ] docs updated if config shape changes
