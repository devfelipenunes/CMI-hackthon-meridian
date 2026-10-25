# SECURITY — CMI Auctions

## Core invariants

### S1 — No bid price in clear text on-chain

Forbidden locations:

- contract storage;
- events;
- logs;
- public proof inputs;
- application transaction metadata.

`requested_quantity` is exempt (it is deliberately public, per ADR-019) — only `price` is covered by this invariant.

### S2 — Accepted bid set is canonical

The operator cannot add, remove, reorder, or replace accepted bids after close, and cannot choose the clearing price or resulting allocation arbitrarily — both must be verified against the real bid set by the `winner_allocation` proof (ADR-019).

### S3 — Nullifier replay protection

Nullifiers must remain available for every state in which the market can accept bids. After `CLOSED`, `submit_bid` is impossible regardless of nullifier retention.

### S4 — Asset custody

From `OPEN` until a terminal state, the auctioned quota asset remains under contract control.

### S5 — Config immutability

After `OPEN`, market config is immutable, including total quotas and minimum price per quota.

### S6 — Trusted public inputs come from contract state

The contract reconstructs trusted proof inputs wherever possible — including `requested_quantity`, `bid_count`, `total_supply`, the canonical root, **and `collateral_binding`** (read directly from the Confidential Token's current on-chain allowance state for the bidder/Auction Contract pair); For the settlement-binding proof, `bid_commitment`, `requested_quantity`, `filled_quantity` and `fee_bps` come from contract state, and `c_seller`/`c_fee`/`c_refund` are decoded from the exact payload bytes the contract forwards to the token (ADR-023, ADR-026). None of these are accepted as caller-supplied claims. Accepting `collateral_binding` from the caller instead of reading it from the token's own state would let a bidder point a proof at a stale, unrelated, or someone else's allowance.

### S7 — Atomic per-bid settlement

For a given accepted bid, its settlement-binding proof, payment leg (to the seller), house-fee leg (to the platform fee wallet), refund leg (to the bidder, for any unfilled portion) and quota transfer either all succeed or all revert, within one settlement call and one transaction (ADR-020/ADR-023). A rollback after the payment leg ran was demonstrated on-chain in POC-6. One bid's settlement failing or being delayed must never block or affect any other bid's settlement.

### S8 — Automated, permissionless settlement/refunds

Settlement and refunds are exposed as a single per-bid entry point that is safe to call by anyone, any number of times (idempotent), and is called automatically by the platform's own automation right after finalization — see ADR-020. Anyone may *submit* it, but its payloads carry `SpenderTransfer` proofs that only the operator can *build* with `sk_op` (ADR-023). The operator-offline case is post-MVP (OQ-15). This preserves the pull-refund property (no O(N) loop, no single stuck recipient) while removing the need for a bidder or seller to manually claim anything in the ordinary case.

### S9 — Deterministic escape path

If finalization does not occur before `finalize_by_ledger`, the market can be cancelled permissionlessly, and every locked collateral position becomes refundable through the same automated entry point as S8, with `filled_quantity = 0`. If the operator itself is gone, each bidder can always exit with the token's own `revoke_spender` (OQ-15).

### S11 — Settlement amounts are proof-bound

The amounts moved by the three settlement legs are fixed by the settlement-binding proof (seller `gross − fee`, fee `floor(gross × 10%)`, refund `price × unfilled`, with `gross = price × filled` and `price` bound to the bid commitment). Skipping the fee or overcharging it was rejected on-chain in POC-6 (ADR-026). The operator's `SpenderTransfer` proofs alone would allow any amount up to the allowance (ADR-023, OQ-13; an overpayment was rejected on-chain in POC-6).

### S10 — Exact collateralization

For every accepted bid:

```text
locked_collateral_value == price × requested_quantity
```

At settlement, a bid filled for `filled_quantity` (which may be less than `requested_quantity` at the clearing margin) pays `price × filled_quantity` to the seller and recovers `price × (requested_quantity − filled_quantity)` back to the bidder. No leverage, and no unaccounted-for collateral in either direction. See ADR-018.

**Caveat — this is a snapshot guarantee, not a continuous one (decided: ADR-024 D4/D13).** `revoke_spender` on the Confidential Token is an owner-authorized operation the Auction Contract does not control, and it works even on an expired delegation. Nothing currently prevents a bidder from deliberately revoking their own allowance after their bid is accepted into the canonical root but before settlement executes — see OQ-11. (A second, related failure mode — the delegation simply expiring because `live_until_ledger` was set too short — is closed by a validation at bid submission in RF-09/RF-14. That validation is mandatory, because the token itself accepts any `live_until_ledger`, even one in the past (POC-5).) A winning bid that can no longer settle is closed with `release_unsettled`, and its quota units return to the seller (RF-20). The blast radius of the remaining, deliberate case is self-contained (ADR-020 settles each bid independently, so this cannot block or affect any other bidder), but it means an accepted winning bid is not a durable guarantee of completed revenue for the seller until settlement actually confirms.

## Known, accepted information leakage

These are deliberate, understood narrower privacy properties — not full confidentiality claims — and should not be assumed away when reading G1/G2 in `docs/PRODUCT.md`:

- **A partial fill reveals an exact price tie.** Because the clearing-price rule (ADR-019) only partially fills the bid(s) exactly at the clearing price, a partially-filled `bid_index` publicly reveals that its price equals the clearing price exactly — strictly more ordering/equality information than "this bid won" or "this bid lost." No numeric price is ever published, but the equality itself is observable from the public allocation output.
- **The operator and the token auditor see locked amounts from lock time** (ADR-024 D2/D3). In the MVP both are the operator, so it learns every bid's price as soon as collateral is locked, independently of when the envelopes are decrypted.
- **The seller learns each winner's price after settlement** (ADR-024 D20). Each payment is a separate confidential transfer to the seller, and `filled_quantity` is public. Losers' prices stay hidden from the seller.
- **Confidential Token deposit amounts are public.** `deposit` publishes its amount. A bidder who deposits exactly `price × requested_quantity` reveals the price, so wallets should deposit unrelated amounts.
- **Cross-market linkability.** `participant_id` ↔ `Address` mappings and each bid's `requested_quantity` are public per market (`docs/PRODUCT.md`). Nothing prevents correlating the same wallet's participation and requested quantities across many markets on the same platform, which can reveal an investor's aggregate position size or strategy even though every individual price stays hidden. Anonymity is already an explicit non-goal (`docs/PRODUCT.md`); this is the concrete mechanism by which that manifests across, not just within, a single market.

## Threat model

| Threat | Impact | Mitigation / Status |
|---|---|---|
| Replay | Medium | Nullifier + state gating |
| Commitment copying | Medium | Participant ID + market ID in commitment |
| Brute-force commitment | High | High-entropy blinding |
| Seller removes asset | High | Escrow before `OPEN` |
| Underfunded bid | High | Exact collateralization proof, bound to the real Confidential Token allowance (ADR-018) |
| Operator computes a false allocation | High | `winner_allocation` proof, verified on-chain (ADR-019) |
| Operator omits an accepted bid | High | Canonical root derived from contract state |
| Operator disappears | High | Permissionless timeout cancellation (ADR-016). **Refunds then become bidder-initiated** (`revoke_spender`), because every automatic leg needs an `sk_op` proof (ADR-023). The MVP assumes the operator is always online; post-MVP in OQ-15 |
| Platform backend visibility across markets | Medium | Explicit trust boundary (ADR-021); never exposed publicly; cannot alter outcomes without a valid proof |
| Compromise of the platform operator's keys (envelope decryption key, `sk_op`, admin wallet, fee wallet) | Critical | **Accepted for the testnet MVP (ADR-024 D5/D14/D19/D22).** A single envelope key covers every market on the platform; compromise (theft, insider misuse, or legal compulsion) exposes every bid price handled by that key, retroactively if ciphertexts remain retrievable (OQ-05). Needs a key-management design (rotation, HSM/secure enclave, or eventual MPC/threshold per the Phase 3 roadmap) before production. **MVP:** `sk_op` lives in the backend database (ADR-024 D5); the envelope decryption key and the fee wallet follow the same policy, as separate keys (ADR-024 D19/D22); HSM/TEE is post-MVP |
| Operator decrypts a bid before market close | High | **Accepted for the MVP (ADR-024 D2/D6, OQ-12/OQ-14).** Besides the envelope, the operator also reads `price × quantity` from the escrow at lock time, as the spender and as the token auditor |
| Bidder revokes their Confidential Token allowance after acceptance, before settlement | High | **Decided — ADR-024 D4:** that bid's quota units return to the seller. It closes through `release_unsettled` (ADR-024 D13, RF-20) |
| Bidder's delegation expires (`live_until_ledger` too short) before settlement runs | High → **Mitigated** | **Resolved — OQ-11 (negligent-expiry half).** RF-09/RF-14 reject a bid at submission unless `live_until_ledger >= finalize_by_ledger` plus a safety margin. |
| Same allowance referenced or overwritten across two concurrent markets on a shared Auction Contract | Critical (mitigated by deployment rule) | **Resolved — OQ-10.** Confirmed against real source: `set_spender` reverts with `DelegationAlreadyExists` on a second call for the same (owner, spender) pair — overwriting/double-referencing is not possible, it fails cleanly instead. Decision: deploy one Auction Contract per concurrently-open market; a shared contract cannot serve more than one market at a time. |
| Malformed bid envelope bricks finalization | Critical | **Resolved — OQ-01.** ECDH-derived envelope masking, proved inside `bid_validity`'s own witness set (`ADR-004` update); the exact attack this row describes — a valid commitment/proof paired with a garbage ciphertext — fails at witness-solving, confirmed by a working circuit verified on Stellar testnet (`POC/poc-2-envelope-consistency`). |
| Collateral proof not linked to the real Confidential Token allowance | Critical | **Resolved — OQ-02.** The POC-3 linkage circuit verified against a `C_a` read live from the deployed token (POC-5) |
| Confidential Token doesn't support partial allowance consumption as assumed | — | **Resolved — confirmed against real source (`ADR-018` update): `confidential_transfer_from` updates the delegation's commitment rather than deleting it, so partial consumption followed by `revoke_spender` on the remainder is supported as assumed.** (Not itself a POC target this round; carried forward from the earlier source-reading pass.) |
| Verifier accepts invalid proof | Critical | Negative proof tests + immutable verifier after `OPEN` |
| TTL expiry | High | Explicit TTL policy |
| Settlement-automation downtime | Medium | Anyone can submit `settle` (ADR-020), but the payload must be built by the operator with `sk_op` (ADR-023). A keeper outage only delays settlement; an operator outage is OQ-15 |
| Config manipulation | High | Frozen config + config hash |
| Eligibility changes | Medium | Disabled by default (ADR-011); revalidated at bid time if enabled |
| Frontend leaks secret | High | No analytics/logging of private values |
| Ciphertext unavailable | High | Storage/indexing decision must preserve availability |
| Confidential settlement API mismatch | Critical | **Resolved.** API validated live (POC-5), mechanism frozen in ADR-023 (POC-6) |
| Operator skips, skims or inflates the house fee | High | **Mitigated — ADR-026.** The fee amount is bound by the settlement-binding proof; both cases were rejected on-chain (POC-6) |
| Operator overpays or underpays a settlement leg | Critical | **Resolved — OQ-13.** Settlement-binding proof verified by the Auction Contract before forwarding the token payloads (ADR-023). An overpayment with valid token proofs is rejected on-chain (POC-6) |
| Admin of our own token / verifier / auditor deployment swaps a verification key | Critical | **Accepted for the testnet MVP (ADR-024 D14, OQ-17).** Roles are held by a dedicated operator admin wallet in the backend DB; compromise of that wallet can make the token accept forged proofs. Hardening (HSM/multisig/renounce) is post-MVP |
| Winning bidder has no trustline for the quota asset | Medium | **Mitigated — ADR-024 D18.** `place_bid` rejects bidders without a trustline |
| Quota issuer claws back escrowed units | High | **Mitigated — ADR-024 D18.** Assets with clawback enabled are rejected at market creation |

## Security review rule

A requirement with a Critical BLOCKER cannot be marked `DONE` until the blocker is resolved in an ADR/spec update.
