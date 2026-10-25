# RF-22 — Consultar Estado e Emitir Eventos

## Dependencies
Cross-cutting; implement after core state types stabilize.

## Blockers
None.

## Goal
Expose read-only market information and compact indexable lifecycle events without leaking private amounts.

## Queries
- `get_market`
- `get_state`
- `get_participant_id`
- `get_bid_count`
- `get_bid_record` — including public `requested_quantity`, without private price
- `get_allocation` — `filled_quantities` per `bid_index`, once `FINALIZED`
- `has_nullifier`
- `get_config_hash`
- `get_commitments_root`
- `get_finalize_by_ledger`
- `get_settlement_status` — whether a given `bid_index` has been settled yet (RF-20/RF-21)

## Events
Expected lifecycle events:
- market created
- asset deposited (may be the same event as "market opened" when deposit and opening are one call)
- market opened
- participant registered
- collateral locked without amount: emitted by the Confidential Token's own `set_spender` event, since the lock is a direct bidder call on the token (RF-09); the Auction Contract does not emit it
- bid accepted, with public `requested_quantity`, without price
- market closed
- market finalized, with the allocation (`filled_quantities` per `bid_index`), without price or clearing price
- per-bid settled (payment and/or refund executed), without amount
- per-bid failed (`release_unsettled`), without amount
- market cancelled
- market settled: no bid is left open and the remaining fee reserve returned to the seller (RF-20, "End of the market")

## Must
- keep queries read-only
- omit bid price, collateral, and settlement/refund amount values
- prefer IDs/commitments/public quantities over redundant sensitive metadata

## Must Not
- emit private plaintext for debugging
- expose operator-decrypted openings
- expose the clearing price

## Acceptance Criteria
- queries return canonical state
- queries do not mutate state
- event payload privacy test passes
- index-relevant IDs and public quantities present

## Related Files
- `contracts/auction/src/events.rs`
- `contracts/auction/src/lib.rs`
- `tests/events.rs`
- `tests/queries.rs`

## Definition of Done
- [ ] event privacy audit
- [ ] query tests

## Settlement events
- `Settled { bidder, filled_quantity }`: no amounts, validated in POC-6. The house fee is never emitted in clear; it appears only as a confidential `spender_transfer` to the fee wallet.
- `release_unsettled` emits a `Failed { bidder, filled_quantity }`-style event with no amounts.
- The market-settled event carries only the `market_id`. It is emitted when the last open bid closes, in a `FINALIZED` market (which becomes `SETTLED`) **and** in a `CANCELLED` one (which stays `CANCELLED`). It means "no bid left open, reserve returned", not "an auction was settled": indexers read `get_state` to tell the two apart.
- The Confidential Token emits its own events (`set_spender`, `spender_transfer`). They carry no clear amounts, but the token auditor, the operator in the MVP, can decrypt them (ADR-024 D2).
