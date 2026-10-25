# ADR-008 — One accepted bid per participant per market

## Decision

Each registered participant can have at most one accepted bid.

Participants receive a market-scoped `participant_id`.

## Reason

Simplifies:

- nullifier logic;
- collateral accounting;
- canonical root construction;
- winner proving.

## Trade-off

No bid revision in MVP.

## Update — quantity field
Under the multi-unit model (ADR-019), the single accepted bid described above is a `(price, requested_quantity)` pair, not a bare price: `price` stays private inside the commitment (ADR per `docs/CRYPTO.md`), `requested_quantity` is public. This decision — at most one accepted bid per participant per market — is unchanged; a participant cannot submit a second bid to request more quotas at a different price ("bid laddering" is explicitly not supported in this version).
