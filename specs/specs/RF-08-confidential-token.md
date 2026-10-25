# RF-08 — Integrar o Confidential Token da Stellar

## Dependencies
- RF-01

## Blockers
None. OQ-02 was resolved live (POC-5) and OQ-06 was resolved by ADR-023 (POC-5/POC-6).

## Goal
Integrate Stellar's real Confidential Token — used directly, not reimplemented — for collateral, refunds, and settlement, via its own `set_spender` / `confidential_transfer_from` / `revoke_spender` allowance primitive (ADR-018).

## Must
- use the actual deployed contract/API, confirmed against the real interface, not remembered from documentation
- document the required auditor/authorization/proof setup for each call used
- keep every amount confidential throughout
- expose only the minimum Grumpkin-commitment binding needed by `bid_validity` (ADR-018/OQ-02)

## Must Not
- invent method names
- use a clear-value token and mark this RF complete
- define a fake `collateral_commitment` format — use the token's own `C_a` allowance commitment
- refund through `revoke_spender` — it needs the bidder's own proof and signature (ADR-023)

## Acceptance Criteria
- real confidential funding works via `set_spender`
- a stable Grumpkin-commitment binding is available to `bid_validity`
- confidential settlement payment works via `confidential_transfer_from`, for both full and partial fills
- confidential refund works via `confidential_transfer_from(spender = auction, from = bidder, to = bidder)`, for both full losses and partial-fill remainders (ADR-023)
- the Auction Contract registers itself as a confidential account from its constructor, with the spender key `sk_op` held by the operator (ADR-023)
- targets CMI's own token/verifier/auditor deployment (auditor = operator, admin = dedicated operator wallet; ADR-024 D3/D14), wrapping native XLM (D10)

## Related Files
- `contracts/auction/src/escrow.rs`
- `contracts/auction/src/settlement.rs`
- `integrations/confidential-token/`
- `tests/confidential_token.rs`

## Definition of Done
- [ ] OQ-02 resolved
- [ ] OQ-06 resolved
- [ ] real integration tests pass, including a genuine partial-fill case
