# RF-06 — Verificar Elegibilidade

## Dependencies
None.

## Blockers
None. Out of the MVP (ADR-024 D9): implement only the disabled-by-default interface.

## Goal
Keep eligibility/compliance separate from auction logic behind a minimal policy interface, shipped disabled by default (ADR-011 update).

## Interface
```rust
fn is_eligible(participant: Address, market_id: u64) -> bool;
```

## Behavior
- `None` policy (the MVP default for every market unless explicitly overridden): every participant is eligible, no identity verification of any kind;
- configured policy: cross-contract policy result is authoritative.

## Must
- check eligibility at registration
- re-check eligibility at bid submission
- default every new market to the `None` policy unless the seller explicitly configures one at creation

## Must Not
- hardcode Zolvency-specific logic in Auction Contract
- guess external method signatures
- require any identity verification for a market that did not opt into a policy

## Acceptance Criteria
- default (`None`) policy accepts everyone
- a configured policy can deny
- revocation between registration and bid blocks the bid, when a policy is configured
- fallback implementation works independently of any external adapter

## Related Files
- `contracts/auction/src/participant.rs`
- `contracts/auction-policy/src/lib.rs`
- `contracts/auction-policy/src/merkle.rs`
- `contracts/auction-policy/src/zolvency.rs`
- `tests/eligibility.rs`

## Definition of Done
- [ ] generic interface implemented
- [ ] default-open behavior tested
- [ ] external adapter only marked done with a real, confirmed interface
