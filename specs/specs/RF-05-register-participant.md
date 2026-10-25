# RF-05 — Registrar Participante

## Dependencies
- RF-03
- RF-06

## Blockers
None; eligibility is disabled by default (ADR-011) and any external adapter integration is optional.

## Goal
Register a wallet in an OPEN market and assign a field-friendly participant ID.

## Inputs
- `market_id`
- authenticated participant address

## State Changes
- allocate market-scoped `participant_id: u32`
- store `Address -> participant_id`
- store `participant_id -> Address`

## Must
- require participant auth
- require `OPEN`
- run eligibility check (a no-op pass when the market's policy is `None`, the MVP default)
- reject duplicate registration
- assign IDs monotonically within a market

## Must Not
- imply that registration itself means a bid was submitted
- require identity verification unless the market explicitly opted into a policy
- log any future bid price

## Acceptance Criteria
- eligible wallet gets one participant ID
- duplicate registration fails
- ineligible wallet fails when a policy is enabled
- any wallet succeeds when the default `None` policy is in effect
- IDs map bidirectionally to the correct wallet

## Related Files
- `contracts/auction/src/participant.rs`
- `contracts/auction/src/storage.rs`
- `contracts/auction/src/events.rs`
- `tests/participant.rs`

## Definition of Done
- [ ] auth tested
- [ ] eligibility tested (both default-open and policy-enabled cases)
- [ ] duplicate tested
- [ ] ID mapping tested
