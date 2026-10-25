# ADR-004 — Accepted bids require an envelope mechanism

## Context
Winner proving requires private bid openings, but the public chain must not learn them.

## Decision
Each accepted bid must include or reference encrypted private opening material sufficient for winner proving.

Target private data:
- value
- blinding
- nullifier seed

## Critical Requirement
The protocol must prevent an accepted bid from carrying an unusable or commitment-inconsistent envelope.

Ordinary encryption alone does not satisfy this requirement.

## Forbidden
Do not finalize the bid-submission implementation with ciphertext consistency unspecified.

## Update — construction frozen and validated

PLAN-002's chosen construction: **ECDH-derived envelope masking, proved inside the same circuit (`bid_validity`) that opens the bid commitment** — not a separate proof, and not operator pre-validation (the two other candidate paths this ADR originally left open). Built and validated end to end as `POC/poc-2-envelope-consistency`:

```text
1. commitment          == Poseidon2(BID_COMMIT_DOMAIN, price, market_id, participant_id, blinding, nullifier_seed)
2. R                    == r · G                                    (bidder's ephemeral point, public)
3. S                    == r · PK_operator                          (shared secret, sender side, private)
4. mask_price           == Poseidon2(BID_ENVELOPE_MASK_DOMAIN, S.x, S.y, 0)
5. mask_blinding        == Poseidon2(BID_ENVELOPE_MASK_DOMAIN, S.x, S.y, 1)
6. mask_seed            == Poseidon2(BID_ENVELOPE_MASK_DOMAIN, S.x, S.y, 2)
7. ciphertext_price     == price + mask_price
8. ciphertext_blinding  == blinding + mask_blinding
9. ciphertext_seed      == nullifier_seed + mask_seed
```

`R`, `ciphertext_price`, `ciphertext_blinding`, `ciphertext_seed` are public inputs; `price`, `blinding`, `nullifier_seed`, `r` are private witnesses shared with `bid_validity`'s other constraints (commitment opening, nullifier, price floor, collateral linkage) — one proof, one set of witnesses, so a commitment/envelope divergence is structurally unprovable, not merely discouraged.

**Why this satisfies the Critical Requirement above, with evidence, not just an argument:**
- ECDH commutativity (`r · PK_operator == sk_operator · R`) was independently confirmed empirically, not just asserted from theory — a test recomputes the shared secret from the recipient's side and recovers the exact original `price`.
- The literal attack this ADR exists to prevent — a valid commitment/proof paired with a garbage ciphertext — fails at witness-solving; no valid proof can even be attempted with an inconsistent envelope.
- Verified on real Soroban testnet infrastructure (not just local proving): contract `CAQZ733ICVYAMPAS4WLJRGYUYCTHFV6TSSULG5JLO3GO7P4BX6YM2NAY`, `verify_proof` succeeded, 91,051,355 CPU instructions — in the same flat-cost band as every other circuit measured (OQ-03).

The historical note below is superseded by ADR-025: the domain table and Poseidon2 sponge are frozen. `BID_COMMIT_DOMAIN = 1001` and `BID_ENVELOPE_MASK_DOMAIN = 1002` were initially POC-local values; the definitive protocol table is now in `docs/CRYPTO.md`.

**Not yet done**: merging these 9 constraints into `bid_validity`'s actual production circuit alongside the commitment/nullifier/price-floor constraints (trivial, not yet a design question) and the collateral-linkage constraint (ADR-018/OQ-02, already designed separately as `POC/poc-3-collateral-linkage`). See `POC/PLAN.md` (POC-2 section) and `POC/results/SUMMARY.md` for full detail.
