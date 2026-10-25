# ADR-027 — Finalization grace is a platform parameter, with a floor

## Context
ADR-024 D7 fixed the finalization grace at 2 days: after `close_ledger`, the operator has `FINALIZATION_GRACE_LEDGERS = 34_560` ledgers to call `finalize`; after that, anyone may `cancel_expired` and every bid is refunded (ADR-010, ADR-016). In the contracts this is a compile-time constant copied into each market's `MarketConfig.finalization_grace_ledgers`.

The constant is right for production, but it makes the timeout path impossible to exercise end to end in reasonable time: the release E2E (`MVP.timeout_refunds`, D-07/D-20 of the contracts) must wait 34_560 ledgers — about 9.6 hours on the local quickstart (1 ledger/s, its fastest stable rate) and 2 days on testnet (5 s/ledger). A release candidate cannot be validated in one working session, and a test build with a smaller constant cannot produce release evidence, because its WASM differs from the released one.

Most of the mechanism is already in place: each market stores its own `finalization_grace_ledgers` in `MarketConfig`, the value is covered by `config_hash` (so a bidder sees it before bidding), `finalize_by_ledger` is computed from it, and the SDK reads it from the market config.

## Decision
1. **The grace is a platform parameter.** `PlatformConfig` gains `finalization_grace_ledgers: u32`. The Factory admin sets it at deploy (constructor) and may change it with `set_platform_config`, like the verifier addresses and the fee wallet.
2. **Each market freezes its own value.** The Auction copies the platform's value into its `MarketConfig` at creation (as today with the constant). A change of the platform value affects only markets created afterwards; a market's window never changes, and it is part of its `config_hash`.
3. **Bounds enforced on-chain.** The Factory rejects a platform config outside `MIN_FINALIZATION_GRACE_LEDGERS = 12` and `MAX_FINALIZATION_GRACE_LEDGERS = 34_560` (`FactoryError::InvalidFinalizationGrace`). The maximum is the current 2 days, so every storage TTL computed with it remains an upper bound.
4. **Production keeps 2 days.** The deploy script's default is 34_560. Shorter values are for test networks: the local quickstart and the testnet used for release candidates.
5. **Everything else stays constant:** `SETTLEMENT_MARGIN_LEDGERS` (1 day), `TTL_BUFFER_LEDGERS` (1 day) and `MAX_DURATION_LEDGERS` (30 days). They do not add waiting time to any flow: the margin only lengthens the collateral lock required from the bidder (`live_until ≥ close + grace + margin`) and the storage TTLs.

## Consequences
- A release candidate can run the whole E2E — including the timeout path — in about 30 minutes on quickstart and about one hour on testnet, against the released WASM.
- The interface changes (`PlatformConfig` has one more field, `FactoryError` one more code), so it needs a new contracts release and the SDK's regenerated bindings.
- Because `PlatformConfig` is nested in `MarketConfig`, every `config_hash` changes; the test vectors and proof fixtures that carry it are regenerated.
- **Risk:** an admin can deploy a short window on a production network. A short window only makes a timeout (and full refunds) more likely; it never lets anyone take funds. The on-chain floor bounds it, the window is visible in each market's config before bidding, and the contracts' `--check-deployment` warns when a non-local network runs with less than 2 days.

## Alternatives considered
- **Keep the constant and wait** (status quo): 9.6 h / 2 days per release candidate.
- **A test-only WASM** built with a smaller constant (cargo feature): fast for development and CI, but it cannot produce release evidence. It can still be added later for CI.
- **A per-market parameter chosen by the seller**: the seller would control a window that protects the bidders; the platform parameter keeps that choice with the operator, who is accountable for finalizing.
