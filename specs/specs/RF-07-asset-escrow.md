# RF-07 — Depositar e Bloquear Cotas do Ativo Leiloado

## Dependencies
- RF-01
- RF-03

## Blockers
None. The quota asset must be a SAC asset without clawback, with 1 quota = 1 whole unit (ADR-024 D18).

## Goal
Move the exact configured `total_quotas` amount of the fungible quota asset under contract control before `OPEN`.

## Preconditions
- market is `CREATED`
- caller is seller
- asset not already deposited

## State Changes
- transfer `total_quotas` units of the asset to escrow
- mark asset escrowed

## Must
- require seller auth
- open only after escrow is confirmed
- release quotas only through per-bid settlement (RF-20) or a valid cancellation

## Must Not
- allow partial configured deposit unless protocol explicitly adds such a state later
- allow seller withdrawal while active

## Acceptance Criteria
- cannot open before deposit
- exact `total_quotas` amount is escrowed
- double deposit rejected
- cancellation returns the full escrowed amount to the seller
- settlement sends each winner exactly their `filled_quantity`
- unsold quotas (`total_quotas − Σ filled`) return to the seller at `FINALIZED` (ADR-024 D13)
- a `FAILED` bid's `filled_quantity` returns to the seller via `release_unsettled` (RF-20, ADR-024 D13)

## Related Files
- `contracts/auction/src/escrow.rs`
- `contracts/auction/src/market.rs`
- `tests/asset_escrow.rs`

## Definition of Done
- [ ] custody paths tested
- [ ] double-spend/withdraw path tested
- [ ] undersubscription leftover-quota path tested
