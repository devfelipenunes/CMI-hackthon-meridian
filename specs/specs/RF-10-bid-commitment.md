# RF-10 — Criar Commitment do Bid

## Dependencies
- RF-02
- RF-05

## Blockers
None.

## Goal
Create a hiding/binding commitment over a bid's price, scoped to the market and registered participant.

## Construction
```text
C = Poseidon(
    BID_COMMIT_DOMAIN,
    price,
    market_id,
    participant_id,
    blinding,
    nullifier_seed
)
```

`requested_quantity` is **not** part of this commitment — it is a separate, plain public value attached to the bid (see RF-11), since it is never meant to be hidden.

## Must
- use fixed domain separator
- use high-entropy blinding
- use contract-derived `participant_id`
- keep exact field ordering stable

## Must Not
- bind raw Stellar Address directly in the circuit
- omit market or participant scope
- fold `requested_quantity` into the commitment
- change ordering without ADR

## Acceptance Criteria
- same price with different blinding gives different `C`
- different participant ID changes `C`
- different market ID changes `C`
- test vector is documented

## Related Files
- `circuits/shared/commitment.*`
- `sdk/commitment.*`
- `tests/commitment.*`
- `docs/CRYPTO.md`

## Definition of Done
- [ ] deterministic test vectors
- [ ] client/circuit outputs match

## Frozen construction (ADR-025)
`C = Poseidon2(1001, price, market_id, participant_id, blinding, nullifier_seed)`, using the Confidential Token's standard sponge.

Test vector (from POC-2): `price = 650`, `market_id = 42`, `participant_id = 7`, `blinding = 111222333444`, `nullifier_seed = 999888777` gives `C = 0x02a90cb9c403c8001ce4bf3f4ed7376804d7101074cb1ebc42cdb13069136281`.
