# ADR-021 — The operator is the platform's own automated backend, not the seller

## Context
ADR-003 established that the MVP does not claim operator blindness, but left open who actually holds the operator role. The product is a multi-tenant platform: many seller companies list auctions through it, and a single shared backend — not each seller — performs winner determination.

## Decision
The operator role (decrypting accepted bid envelopes after close, computing the allocation, generating the allocation proof, and submitting it on-chain) is performed by the platform's own backend infrastructure, run automatically and without manual intervention. It is never the seller company that opened a given market, and never a bidder.

"After close" here describes the intended operational practice of this automation, not a cryptographically enforced property — see ADR-003's update and OQ-12. Nothing stops the same backend from technically decrypting earlier if it chose to; the guarantee this ADR actually provides is about *who* runs the decryption (never the seller, never a bidder), not about exactly *when* it happens.

The seller only ever receives the aggregate settlement payment (per ADR-018/ADR-020); it never holds the operator role and never decrypts any bid.

## Consequences
Pros:
- sellers get a fully automated flow (list an asset, receive proceeds) without ever needing to run any cryptographic infrastructure themselves;
- keeps the trust boundary in one place (the platform's own backend) instead of duplicating it across every seller.

Cons:
- the platform's backend sees bid prices across every market it operates, not just one — a larger concentration of visibility than a per-seller operator would have, though still never exposed publicly and never usable to alter outcomes (any allocation the operator submits must still pass the on-chain allocation proof, per ADR-019);
- if the platform's own backend becomes unavailable, the only recovery path for a given market is the permissionless timeout cancellation (ADR-016) — there is no fallback second operator in this version.

## Forbidden
Do not let a seller-supplied key or seller-run process take on the operator role. Do not treat "the operator is automated" as removing the need for the allocation proof to be verified on-chain — automation changes who runs the process, not whether the contract trusts it blindly.

## Update — operator keys in the MVP (, ADR-024 D5/D14/D19)
The operator backend holds, in its database and as separate keys:
- the envelope decryption key;
- the spender key `sk_op` (also used as the token auditor key, D3);
- a dedicated admin wallet for CMI's token/verifier/auditor deployment.

HSM/TEE custody is post-MVP.
