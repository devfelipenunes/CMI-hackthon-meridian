# RF-04 — Imutabilidade Durante o Leilão

## Dependencies
- RF-01
- RF-03

## Blockers
None.

## Goal
Freeze all economically/security-relevant market configuration before bids can be accepted.

## Frozen Fields After OPEN
- asset
- total quotas
- settlement/collateral token
- minimum price per quota
- close ledger
- finalization grace
- verifier
- eligibility policy
- auction rule (pay-as-bid, clearing-price + FCFS margin — ADR-019)
- `MAX_BIDS`/protocol version reference

The operator's identity/key is deliberately **not** part of per-market config — it is fixed platform infrastructure (ADR-021) and has no per-market entry to freeze.

## State Changes
On open:
- compute `config_hash`
- store `config_hash`
- transition to `OPEN`

## Must
- derive `config_hash` deterministically
- represent 32-byte hash in proofs as two 128-bit limbs if required by verifier encoding
- keep public-input serialization stable

## Must Not
- accept caller-provided `config_hash` as authoritative
- mutate frozen config after `OPEN`

## Acceptance Criteria
- open freezes config
- post-open mutation fails
- same config yields deterministic hash
- proof inputs use stored hash, not caller-supplied hash

## Related Files
- `contracts/auction/src/market.rs`
- `contracts/auction/src/types.rs`
- `contracts/auction-verifier/src/lib.rs`
- `tests/config.rs`

## Definition of Done
- [ ] immutable fields covered by tests
- [ ] config hash vectors documented
