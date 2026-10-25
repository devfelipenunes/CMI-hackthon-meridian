# ADR-011 — Eligibility is pluggable; Zolvency is non-critical

## Decision
Auction logic depends only on a minimal eligibility-policy interface.

Intended adapter:
- Zolvency

Fallback:
- Merkle allowlist or another local policy

## Reason
Identity/compliance must not block the core auction implementation or demo.

## Forbidden
Do not hardcode external partner-specific calls into the core Auction Contract.

## Update — default policy for MVP
The MVP ships with eligibility disabled by default (the `None` policy: every registered participant is eligible, no identity verification required to open a market or to bid). This is a deliberate product decision, not a fallback-of-last-resort — the pluggable interface above still exists so a stricter policy (Zolvency, a Merkle allowlist, or another adapter) can be attached later without changing core auction logic.

## Update — out of the MVP (, ADR-024 D9)
Eligibility is out of the MVP and documented only. The interface stays so it can be added later.
