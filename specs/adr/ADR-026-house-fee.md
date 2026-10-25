# ADR-026 — 10% house fee, paid confidentially inside each bid's settlement

## Context
The platform charges a house fee on what each winning bid pays. The fee must be **confidential**: a public fee amount would let anyone compute `fee ÷ 10%` and learn the seller's revenue, and from it the average winning price (G3). So the fee has to move as one more confidential transfer out of the winning bid's escrow, bound by the settlement-binding proof like the other legs.

## Decision
1. **Rate.** Fixed at **10% (`FEE_BPS = 1000`)** for the MVP. It is a platform constant in the Auction Contract and an input to the settlement proof, so a later configurable rate needs no circuit change.
2. **Who bears it.** The fee comes **out of the seller's proceeds**. The bidder still pays exactly `price × filled` and locks `price × requested`, so `bid_validity` and the collateral rule (ADR-018) are unchanged.

   ```text
   gross    = price × filled_quantity
   fee      = floor(gross × FEE_BPS / 10000)
   seller  ← gross − fee
   platform← fee
   bidder  ← price × (requested − filled)          (refund, unchanged)
   ```

3. **Where it goes.** A **dedicated operator fee wallet**. It is a separate key, used only to receive fees and kept in the operator backend DB (ADR-024 D22), and it is registered as a Confidential Token account.
4. **Settlement-binding proof (replaces ADR-023 §3).**
   - **Public-input order:** `bid_commitment, requested_quantity, filled_quantity, fee_bps, c_seller.x, c_seller.y, c_fee.x, c_fee.y, c_refund.x, c_refund.y`. Every value is assembled by the contract, and the three `c_*` points come from the three payloads it forwards.
   - **Statement:**

     ```text
     bid_commitment == Poseidon2(1001, price, market_id, participant_id, blinding, nullifier_seed)
     fee · 10000 + fee_rem == gross · fee_bps,   fee < 2^127,   0 ≤ fee_rem < 10000,   fee_bps ≤ 10000
     c_seller == (gross − fee) · G + r_seller · H
     c_fee    == fee · G + r_fee · H
     c_refund == (price × (requested − filled)) · G + r_refund · H
     ```

   - **Size:** 95 ACIR opcodes, 3,702 gates.
5. **One transaction per bid** (ADR-020 unchanged). `settle(bid_index, seller_data, fee_data, refund_data, proof)` (the POC keyed bids by `bidder`; production uses `bid_index`, RF-20) runs the proof check, the seller leg, the fee leg, the refund leg and the quota transfer, all or nothing.

## Evidence (POC-6, testnet, : 23 PASS, 0 FAIL)
- **Fee bound by the proof.** Valid token proofs that skip the fee, or that charge 20%, are rejected on-chain with `InvalidSettlementProof`. The circuit cannot prove either one.
- **Amounts received.** The seller received 70,200 and the fee wallet 7,800 (10% of 78,000); each decrypted its amount with its own key. The bidder was refunded 52,000.
- **Atomicity.** A refund failure after the seller and fee legs ran reverted the whole call on-chain.
- **Worst case (partial fill: all three legs plus quota)**, measured from the host's `core_metrics`:

  | Resource | Used | Limit | Share |
  |---|---|---|---|
  | CPU instructions | 348.8M | 400M | **87.2%** |
  | Memory | 16.7 MB | 41.9 MB | 39.8% |
  | Transaction size | 62.3 KB | 132 KB | 47.2% |
  | Resource fee | ≈0.29 XLM | — | — |

## Consequences
- **One settlement per ledger.** A full settlement uses about **60% of a ledger's CPU budget** (348.8M of `ledger_max_instructions = 580M` on testnet), so **at most one such settlement fits per ledger**. The keeper therefore submits bids one per ledger: a market with 8 winners needs at least ~8 ledgers (~40 s) to settle, more if other heavy transactions compete for the same ledger.
- **Headroom is now ~51M instructions.** No further proof verification fits in `settle`. Any future check inside settlement must be cheap, or move to a separate step, which would need a new ADR.
- **Skip legs whose amount is publicly zero.** A production optimization: with `filled == 0` the seller and fee legs are zero, and with `filled == requested` the refund leg is zero. The contract can skip those legs, and the circuit simply proves `Com(0, r)` for them. Full and zero fills are then cheaper than the measured worst case.
- **Privacy.**
  - The fee is invisible to the public.
  - The operator already sees every price (ADR-024 D2), so it learns nothing new.
  - The seller sees its net amount.
- **Rounding.** Each fee is floored per bid, so the platform can collect at most 1 base unit less per bid.
- **Two separate charges.** Network fees are still paid from the seller's XLM fee reserve (D15). The house fee is independent of that reserve.
