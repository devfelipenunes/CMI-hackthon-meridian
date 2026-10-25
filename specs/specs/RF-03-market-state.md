# RF-03 — Controlar Estado do Mercado

## Dependencies
None.

## Blockers
None.

## Goal
Enforce the auction lifecycle with explicit states and legal transitions.

## States
- `CREATED`
- `OPEN`
- `CLOSED`
- `FINALIZED`
- `SETTLED`
- `CANCELLED`

## Allowed Transitions
- `CREATED -> OPEN`
- `CREATED -> CANCELLED`
- `OPEN -> CLOSED`
- `OPEN -> CANCELLED` only if there are zero accepted bids
- `CLOSED -> FINALIZED`
- `CLOSED -> CANCELLED` after finalization timeout
- `FINALIZED -> SETTLED`

## Must
- use typed state errors
- expose `get_state`
- emit transition events or include state change in lifecycle events

## Must Not
- allow `FINALIZED -> CLOSED`
- allow reopening
- allow settlement from any state except `FINALIZED`
- treat undersubscription (at least one accepted bid, but total requested quantity below `total_quotas`) as a cancellation trigger — it resolves inside the normal `CLOSED -> FINALIZED -> SETTLED` path per ADR-019's degenerate case

## Acceptance Criteria
- every legal transition succeeds under its guard
- every illegal transition fails
- terminal states cannot transition again
- an undersubscribed market with at least one accepted bid still reaches `FINALIZED`/`SETTLED`, not `CANCELLED`

## Related Files
- `contracts/auction/src/market.rs`
- `contracts/auction/src/types.rs`
- `contracts/auction/src/errors.rs`
- `tests/state_machine.rs`

## Definition of Done
- [ ] full transition matrix tested
- [ ] typed errors tested
