# RF-15 — Impedir Replay

## Dependencies
- RF-02
- RF-05

## Blockers
None.

## Goal
Prevent reuse of a bid authorization/proof in the same market.

## Construction
```text
N = Poseidon(
    NULLIFIER_DOMAIN,
    nullifier_seed,
    market_id,
    participant_id
)
```

## State Changes
On accepted bid:
- `used_nullifiers[N] = true`

## Must
- consume atomically with successful bid
- scope to market and participant
- keep required entry alive while bid submission remains possible

## Must Not
- consume on failed proof
- rely only on account transaction nonce

## Acceptance Criteria
- replay rejected
- failed bid leaves nullifier unused
- different market produces different nullifier
- different participant produces different nullifier

## Related Files
- `contracts/auction/src/nullifier.rs`
- `contracts/auction/src/storage.rs`
- `circuits/shared/nullifier.*`
- `tests/nullifier.rs`

## Definition of Done
- [ ] replay tests
- [ ] TTL behavior documented

## Frozen construction (ADR-025)
`N = Poseidon2(1004, nullifier_seed, market_id, participant_id)`, using the standard sponge.
