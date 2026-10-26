# ADR-024 — MVP business and trust decisions

## Decisions

| # | Topic | Decision (MVP) | Open question |
|---|---|---|---|
| D1 | Refund path | `confidential_transfer_from(to = bidder)`, automatic. Mechanism in ADR-023 | OQ-06 |
| D2 | Who sees bid prices before close | **Accepted and documented.** The holder of `sk_op` (operator) and the token's auditor can decrypt `price × requested_quantity` as soon as collateral is locked | OQ-14 |
| D3 | Token auditor | **The operator is the auditor in the MVP.** CMI therefore deploys its own Confidential Token / verifier / auditor set (the demo deployment's auditor secret is public) and registers the operator's auditor key | OQ-14 |
| D4 | A winning bid cannot settle (bidder revoked or let the lock expire) | **The quota units of that bid return to the seller.** Unsold units under undersubscription also return to the seller | OQ-11 |
| D5 | `sk_op` custody | **One key, stored in the operator backend DB.** HSM/TEE is post-MVP | ADR-023 |
| D6 | Operator trust | **Confirmed.** Operator visibility of bids (ADR-003, OQ-12) is accepted for the MVP | OQ-12 |
| D7 | Timing | **Market duration ≤ 30 days**, chosen per market at creation and immutable (RF-01). **Finalization grace = 2 days** (a platform parameter with a floor since ADR-027; 2 days remains the production value): the operator must finalize within 2 days after close, otherwise anyone may cancel (ADR-010, ADR-016). Close is by time, permissionless | OQ-08 |
| D8 | Where encrypted bid envelopes live | **Contract storage** | OQ-05 |
| D9 | Eligibility (KYC / Zolvency) | **Out of the MVP**, documented only | OQ-07 |
| D10 | Payment asset | **XLM.** The Confidential Token wraps native XLM (SAC) | new |
| D11 | Who pays network fees | **The seller** (≈0.29 XLM per partially filled bid including the house-fee leg, measured in POC-6). Separate from the 10% house fee (D21) | new |
| D12 | Operator availability | **The operator is assumed always online in the MVP.** If it is not, automatic refunds stop and bidders exit with their own `revoke_spender`. Post-MVP limitation | OQ-15 |
| D13 | Winning bid that cannot settle; unsold units | **`release_unsettled(bid_index)`** is permissionless once the token reports the bidder's delegation gone (`is_spender == false`: revoked or expired). The bid's `filled_quantity` goes back to the seller and the bid is marked `FAILED`. Unsold units (`total_quotas − Σ filled`) go back to the seller at `FINALIZED`. `SETTLED` is reached when every bid is `SETTLED` or `FAILED`. Also available in a `CANCELLED` market (see update below) | OQ-16 |
| D14 | Admin of CMI's own token / verifier / auditor deployment | **A dedicated operator wallet**, different from the operator's other keys, stored in the operator backend DB. It holds the admin and manager roles that can update verification keys and rotate the auditor key. Accepted for the testnet MVP; HSM/multisig/renouncing is post-MVP | OQ-17 |
| D15 | How the seller pays fees | **The seller deposits an XLM fee reserve at market creation.** It pays the platform's close/finalize/settle submissions, and the unused remainder is returned to the seller when the market ends | OQ-19 |
| D16 | Target network | **Testnet only.** The Confidential Token is explicitly not production-ready/unaudited; mainnet is out of scope for the MVP | OQ-20 |
| D17 | Bids per market | **At most 8 bids per market** (`MAX_BIDS = 8`, ADR-013), initially. Raising it follows ADR-013/ADR-025 | OQ-21 |
| D18 | Quota asset rules | (a) **A bidder must hold a trustline** for the quota asset: `place_bid` rejects the bid otherwise, e.g. by reading `quota.balance(bidder)`, which fails without one. (b) **Assets with clawback enabled are rejected** at market creation; the platform checks the issuer flags when creating the market, and RF-01 confirms whether an on-chain check is possible. (c) **1 quota = 1 whole unit of the asset** (10^7 base units, 7 decimals) | OQ-18 |
| D19 | Envelope decryption key custody | **Same policy as `sk_op`:** stored in the operator backend DB, as a separate key. HSM/TEE is post-MVP | OQ-21 |
| D20 | Seller visibility of winning prices | **Accepted (option a).** Each winning payment reaches the seller as its own confidential transfer, which the seller decrypts, and `filled_quantity` is public. The seller therefore learns each **winner's** price after settlement. Losers' prices stay hidden from the seller; the public learns no price. No aggregation step in the MVP | OQ-22 |
| D21 | House fee | **Fixed 10%** (`FEE_BPS = 1000`) of each winning bid's payment, taken from the seller's proceeds and paid confidentially inside the same settlement transaction (ADR-026) | new |
| D22 | Fee wallet | **A dedicated operator wallet used only to receive the house fee.** A separate key stored in the operator backend DB and registered as a Confidential Token account. `create_market` refuses to create a market while it is not registered (see update below) | new |

## Derived parameters (D7)
Ledger close time on the target network is about 5 s.

```text
max_market_duration_ledgers  = 30 days  ≈ 518_400 ledgers   (RF-01 rejects close_ledger beyond now + this)
finalization_grace_ledgers   = 2 days   ≈ 34_560 ledgers    (ADR-010: finalize_by_ledger = close_ledger + grace; platform parameter in [12, 34_560] since ADR-027)
required live_until_ledger   ≥ finalize_by_ledger + settlement_margin   (RF-09/RF-14)
settlement_margin            = 1 day    ≈ 17_280 ledgers    (≥ MAX_BIDS ledgers + automation/retry buffer; one full settlement per ledger, ADR-026)
```

**Fixed** in the implementing repository (`contracts`), in its implementation decisions:
- **D-05:** `settlement_margin` = 1 day; storage TTLs are extended to `close_ledger + grace + settlement_margin` plus a 1-day buffer.
- **D-04 (mechanism of D15):** each permissionless call that changes state (close, finalize, timeout cancel, a settle that settles, `release_unsettled`) pays its caller a fixed 0.5 XLM from the seller's fee reserve. Each transition happens once, so the total is bounded by `(2 + MAX_BIDS) × 0.5 XLM` = **5 XLM**, the minimum reserve required at market creation. The remainder returns to the seller when the market ends.

These ledger counts are approximate. RF-01 should derive them from a configured seconds-per-ledger constant rather than hard-code them.

## Update — seller and fee wallet must be token accounts
Every settlement runs its three legs, zero-valued ones included (RF-20): seller, fee wallet, bidder. The Confidential Token rejects a leg whose recipient is not a registered account (`AccountNotRegistered`). A market whose seller or fee wallet had no account therefore could not settle any bid, refunds included, until the delegations expired and every bid ended `FAILED` through `release_unsettled`.

- **Decision:** `create_market` (RF-01) requires both to be registered on the platform's Confidential Token, and fails otherwise with `SellerNotRegistered` / `FeeWalletNotRegistered`, before any `market_id` is allocated.
- **Where:** in the Factory, the one entry point for new markets. A token account cannot be unregistered, so a check at creation holds for the whole life of the market.
- **D22 consequence:** the fee wallet has to be registered (it needs a `register` proof, built by the operator) before the first market can be created. The platform can be deployed with a placeholder and fixed later with `set_platform_config`, but no market is created until then.
- **Bidders** need no check: a bidder can only lock collateral (`set_spender`) from a registered account.

## Update — D13 in a cancelled market
`release_unsettled` is also available when the market is `CANCELLED` (finalization timeout, ADR-016), with the same condition (`is_spender == false`).

- **Why:** a cancelled market refunds each bid through `settle` with `filled = 0`. A bidder who revokes before that refund runs leaves a bid that `settle` cannot close (no delegation) and that `release_unsettled`, limited to `FINALIZED`, also refused. The market's open-bid count never reached zero, so the remaining seller fee reserve (D15) never returned.
- **Effect:** the bid becomes `FAILED` and no quota moves (`filled = 0`; the units already returned at cancellation). The bidder keeps their collateral through `revoke_spender`, as before.
- **End of the market:** when no bid is left open, the remaining reserve returns to the seller and the market-settled event is emitted (RF-22). A `FINALIZED` market becomes `SETTLED`; a `CANCELLED` market stays `CANCELLED`, which is terminal. No state transition is added.
- **Bound:** each bid closes once, so the reimbursements (D-04) stay within `(2 + MAX_BIDS) × 0.5 XLM`.

## Consequences
- **PRODUCT.md "sealed from the operator until close" no longer holds** (D2, D3). The public still never learns prices; the operator/auditor can, from lock time.
- **G8 (deterministic exit) holds in two modes:** automatic while the operator is online, bidder-initiated (`revoke_spender`) otherwise (D12).
- **Wallet guidance:** the `deposit` amount is public on the token. Bidders should not deposit exactly `price × quantity`.
