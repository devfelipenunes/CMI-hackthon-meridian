# PRODUCT — CMI Auctions

## Product goal

Build confidential market infrastructure for tokenized RWAs on Stellar: a **multi-unit, pay-as-bid, first-price sealed-bid quota sale**. A seller fractionalizes an asset into a fixed number of quotas; many bidders compete for them at once; each winner pays their own bid price for the quotas they receive.

The first product provides:

- private bid prices (sealed from the public, first-price sealed-bid);
- public reserve set as a minimum price per quota;
- optional eligibility gating (disabled by default in the MVP — see ADR-011);
- full collateralization per bid;
- ZK-verified allocation of quotas among many simultaneous winners;
- confidential settlement, paid at each winner's own price (pay-as-bid);
- atomic-per-bid asset-for-payment exchange, executed automatically.

## Primary users

- tokenization platforms;
- RWA issuers;
- private-credit originators;
- asset managers;
- institutional marketplaces;
- retail/accredited investors buying fractional positions.

## Problem

Tokenization creates an on-chain asset but does not solve:

- distribution to many buyers at once;
- buyer discovery;
- private price discovery;
- permissioned participation;
- fractional allocation across many winners;
- atomic settlement per winner.

Public markets expose strategy. Traditional private systems require trust in the operator.

## Product thesis

> **Private information, public verification, deterministic settlement.**

## MVP guarantees

- **G1** — Bid prices never appear on-chain in clear text, at any point, for any market outcome.
- **G2** — Losing and winning bid prices both remain private to the public, forever, including after settlement. The seller learns winners' prices (not losers') from the payments it receives (ADR-024 D20).
- **G3** — No single "clearing price" or individual payment amount is published on-chain — this is a pay-as-bid design, not uniform-price.
- **G4** — Every submitted bid is fully collateralized for `price × requested_quantity` before it can be accepted.
- **G5** — Quota allocation is computed over the canonical accepted-bid set — the operator cannot omit, add, or reorder bids.
- **G6** — Allocation (which bids won, and how much of each) is verified on-chain through a ZK proof before any settlement occurs.
- **G7** — Asset delivery and payment settle automatically per accepted bid, in one transaction per bid, without requiring the seller or the bidder to take any manual action. The bidder only `merge`s the refund, a proof-free click, to use it (ADR-023).
- **G8** — Every locked fund has a deterministic exit path, including operator non-finalization and partial fills. While the operator is online the exit is automatic. If it is not, each bidder exits with the token's own `revoke_spender` (ADR-023, OQ-15).
- **G9** — Eligibility is plug-in based and independent from auction logic; the MVP ships with it disabled by default.
- **G10** — The operator cannot move escrowed funds except exactly as the verified allocation and the settlement-binding proof dictate, and cannot choose or alter the allocation outcome or the amounts (ADR-023).

## MVP economic rule

- multi-unit: a fixed total number of quotas per market;
- **pay-as-bid**: each winner pays their own stated price for the quotas they receive, not a shared clearing price;
- **first-price sealed-bid**: each bid's price is sealed at submission and stays hidden from the public forever. The platform's operator, who in the MVP is also the Confidential Token's auditor, can read `price × requested_quantity` as soon as collateral is locked (accepted in ADR-024 D2/D3);
- one bid per participant per market (no bid revision, no bidding ladders in this version);
- each bid states a price per quota (private) and a requested quantity (public);
- allocation rule: highest price first, until quotas run out; ties at the clearing price are broken by lowest `bid_index` (first accepted, first served); see ADR-019;
- exact full collateralization: `locked_collateral_value == price × requested_quantity`; see ADR-018;
- public minimum price per quota (reserve), set by the seller; a bid below it is rejected atomically at submission time (the `bid_validity` proof itself cannot be generated), not accepted and later excluded during allocation — nothing is recorded, and the participant's one-bid-per-market slot is not consumed, so they can immediately retry with a corrected price. No collateral is locked either, because the bidder's app builds the proof before locking funds (RF-09); a bid rejected by the contract after its funds were locked is recovered by the bidder with `revoke_spender`;
- undersubscription is not a cancellation trigger: if total requested quantity is below total supply, every bid fills in full and unsold quotas return to the seller at finalization (ADR-024 D13);
- **house fee: 10%** of each winning payment, taken from the seller's proceeds and paid confidentially to the platform's fee wallet in the same settlement (ADR-024 D21/D22, ADR-026); network fees are paid separately by the seller from an XLM fee reserve deposited at market creation, with the remainder refunded (D11/D15);
- at most 8 bids per market initially (ADR-024 D17);
- **testnet only** (ADR-024 D16);
- payment asset: XLM, via the Confidential Token wrapping native XLM (ADR-024 D10);
- market duration of at most 30 days, fixed at creation; the operator must finalize within 2 days after close, otherwise anyone may cancel (ADR-024 D7);
- quota units of a winning bid that cannot settle, and unsold units, return to the seller (ADR-024 D4/D13);
- the quota asset has no clawback, 1 quota = 1 whole unit of the asset, and a bidder must hold a trustline for it to bid (ADR-024 D18);
- no identity verification (KYC) required by default to open a market or to bid — see ADR-011.

## Public/private boundary

### Public

- market configuration, including total quotas and minimum price per quota;
- registered wallet addresses;
- participant IDs;
- bid commitments;
- requested quantity per bid;
- nullifiers;
- encrypted envelopes/ciphertext, stored in the contract (ADR-024 D8);
- on the Confidential Token: every `deposit` amount in clear text (bidders should not deposit exactly `price × quantity`), and who locked collateral to which market, paid or was refunded, without the amounts;
- proof bytes;
- the final allocation (which `bid_index` values won, and how many quotas each received);
- market state.

### Private to the public

- bid prices — every one of them, winners and losers alike, forever;
- individual settlement payment amounts, and the house fee collected per bid;
- confidential collateral amounts.

(All three are visible to the operator, who is also the token auditor in the MVP (ADR-024 D2/D3). The seller sees each winning payment it receives, and so each winner's price (D20).)

## Trust model

The public chain never learns bid prices, at any point.

The operator role is performed by the platform's own automated backend, never by the seller and never by a bidder — see ADR-021. It sees bid prices: it decrypts the envelopes to compute the allocation (intended after close, but not cryptographically enforced, OQ-12), and as collateral spender and token auditor it can read `price × requested_quantity` as soon as collateral is locked (OQ-14). What *is* guaranteed regardless of timing: the operator cannot act on any knowledge, early or otherwise, to move funds or alter outcomes, because every settlement step depends on the on-chain allocation proof, not on the operator's word.

**MVP trust decisions (ADR-024, ):**
- the operator is the token's auditor;
- the operator holds its keys in its backend database: the single spender key `sk_op`, the envelope decryption key, a separate admin wallet for the token/verifier/auditor deployment, and a separate wallet that only receives the 10% house fee (D5/D14/D19/D22);
- the operator is assumed always online;
- the operator and auditor can read locked amounts, and therefore bid prices, from lock time.

Settlement amounts are nevertheless bound by an on-chain-verified proof, so the operator still cannot choose them (ADR-023).

The MVP does **not** claim:

- anonymous bidders;
- anonymous winners;
- operator blindness (the platform's backend sees bid prices, from lock time — see ADR-003/ADR-021/ADR-024);
- private reserve price;
- production readiness.

## Non-goals

Not in the MVP:

- MPC;
- threshold decryption;
- operator blindness;
- Vickrey (second-price) or uniform-price clearing — this is pay-as-bid by design;
- private reserve;
- configurable or tiered fees (the MVP fee is a fixed 10%);
- bidding ladders (multiple bids per participant);
- mandatory identity verification / KYC;
- mainnet (testnet only, ADR-024 D16);
- formal audit;
- HSM/TEE key custody, multisig admin, settlement while the operator is offline (post-MVP, OQ-15).
