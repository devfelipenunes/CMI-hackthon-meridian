# ADR-023 — Per-bid settlement: spender-driven refund, settlement-binding proof, single transaction

## Context
ADR-018 said the unfilled remainder returns to the bidder via `revoke_spender`. POC-5 showed live that `revoke_spender` requires the **bidder's** proof (built from their `sk`) and signature, so a refund on that path is manual. POC-5 also showed that the token's `SpenderTransfer` proof only establishes `0 ≤ v_tx ≤ allowance`: the amount is a private witness chosen by whoever holds the spender secret `sk_op`, i.e. the operator (OQ-13).

## Decision

1. **Refund leg: `confidential_transfer_from(spender = auction, from = bidder, to = bidder)`.**
   - The Auction Contract calls it; no bidder action is needed.
   - The refund lands in the bidder's *receiving* balance, and the bidder `merge`s it (proof-free) to spend it.
   - A bid filled at zero is refunded in full the same way.
   - `revoke_spender` stays available to the bidder as their own exit (ADR-018 update, OQ-11).
2. **The Auction Contract is a registered confidential account.**
   - It calls `register` from its own constructor, so nobody can register its address first.
   - Its spending secret `sk_op` is held by the operator backend (see 5).
3. **Settlement-binding proof (closes OQ-13).** *(Statement and public-input order superseded by ADR-026, which adds the 10% house-fee leg; kept below as the original record.)*
   - Before forwarding the two `SpenderTransfer` payloads to the token, `settle` verifies a proof of:
     ```
     bid_commitment == Poseidon2(1001, price, market_id, participant_id, blinding, nullifier_seed)   (POC-2 format, unchanged)
     c_pay          == (price × filled_quantity) · G + r_pay · H
     c_refund       == (price × (requested_quantity − filled_quantity)) · G + r_refund · H
     filled ≤ requested; quantities < 2^64; price < 2^63
     ```
   - **Public-input order:** `bid_commitment, requested_quantity, filled_quantity, c_pay.x, c_pay.y, c_refund.x, c_refund.y`. Each is a 32-byte big-endian field.
   - **The contract assembles every public input itself.** The commitment and quantities come from contract state (filled comes from the verified allocation). `c_pay` and `c_refund` are decoded from the exact payload bytes it is about to send to the token.
   - **Frozen by this ADR.** Changing the circuit or the public-input order needs a new ADR.
4. **One transaction per bid (ADR-020).**
   - `settle(bidder, pay_data, refund_data, settlement_proof)` is permissionless. *(Update : the production entry point identifies the bid by `bid_index`, as RF-20 specifies; the POC keyed bids by bidder address. See ADR-026 for the three-leg signature.)*
   - In one call it does: settlement proof, payment leg, refund leg, quota transfer, mark settled.
   - Any failing leg reverts the whole call; this was demonstrated on-chain in POC-6 check 10.1.
   - **Measured (partial-fill worst case, before ADR-026 added the fee leg):**

     | Resource | Used | Limit | Share |
     |---|---|---|---|
     | CPU instructions | 263.2M | 400M | 65.8% |
     | Memory | 13.3 MB | 41.9 MB | 31.6% |
     | Transaction size | 46.9 KB | 132 KB | 35.5% |
     | Fee | ≈0.20 XLM | — | — |
   - There is **no room for a fourth proof verification** in this call.
5. **`sk_op` custody (MVP).**
   - **One** `sk_op` for the platform.
   - Stored in the operator backend's database.
   - Accepted MVP risk: whoever reads that database can build settlement legs, but only amounts the settlement proof allows. They also learn every locked amount (see ADR-024).
   - Post-MVP: HSM/TEE, and a decision on per-market keys.
6. **Settlement fees are paid by the seller** (ADR-024).
   - The keeper submitting `settle` is operated by the platform.
   - The fee is borne by the seller; the accounting mechanism is still to be specified in RF-21.

## Consequences
- Invariant 9 holds: the operator cannot choose amounts, only produce the ones the bid commitment and the verified allocation dictate.
- Invariants 7, 8 and 10 hold under the MVP assumption that the operator is online (ADR-024).
- **Liveness depends on the operator.** Every settlement leg needs a proof built with `sk_op`. If the operator is gone, including when a market is cancelled for non-finalization (ADR-016), refunds cannot be automatic: each bidder exits with their own `revoke_spender`. This is recorded as a post-MVP limitation in OQ-15.
- Delegation expiry must cover the last settlement ledger. The token does not validate `live_until_ledger`; RF-09/RF-14 must (OQ-11).

## Update — house fee (, ADR-026)
§3's statement and public-input order are superseded by ADR-026.
- A third leg pays a confidential 10% fee to the operator's fee wallet.
- The settlement call now forwards three payloads: seller, fee, refund.
- The measured worst case rose from 263M to **348.8M of 400M** CPU instructions.
