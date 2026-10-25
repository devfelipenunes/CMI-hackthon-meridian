# ADR-003 — Operator visibility is an explicit MVP trust assumption

## Context

Winner proving requires access to private bid openings.

## Decision

The MVP does not claim operator blindness.

## Update — this is a trust assumption, not a cryptographic guarantee

Confirmed explicitly, not just left ambiguous: **nothing in this pack's current design cryptographically prevents the operator from decrypting a bid's envelope before the market closes.** Ordinary public-key encryption has no notion of time — whoever holds the operator's private key can decrypt any ciphertext encrypted to it the instant that ciphertext exists, regardless of market state. "The operator only sees bids after close" describes the *intended operational practice*, not an enforced property of the protocol. Any document in this pack stating it as a plain fact should be read with this caveat; several have been corrected to say so explicitly (`docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`).

Real technical enforcement, if this is ever required rather than assumed, would need one of: a TEE/enclave gating decryption on an on-chain ledger check, threshold/MPC decryption across independent parties, or (not recommended) a time-lock/VDF construction. See OQ-12 for the full evaluation. This ADR does not choose one — that remains a future decision, not an MVP requirement.

## Consequences

- Public bid privacy remains a product guarantee.
- Operator privacy is not a product guarantee.
- Operator censorship/liveness risk must be explicit.
- The timing of operator decryption is a trust/policy matter for the MVP, not a cryptographic one — see OQ-12.

## Forbidden

Do not claim that nobody sees bids in the MVP.
Do not claim "operator decrypts only after close" as an enforced property anywhere in this pack — state it as intended operational practice under an explicit trust assumption, with a pointer to OQ-12, unless a real enforcement mechanism from OQ-12 is actually implemented.

## Update — visibility from lock time (, ADR-024 D2/D3/D6)
Besides decrypting envelopes, the operator is the collateral spender and, in the MVP, the Confidential Token's auditor. It can therefore read `price × requested_quantity` as soon as collateral is locked, before close. This is accepted and documented for the MVP (OQ-12, OQ-14).
