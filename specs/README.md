# CMI Auctions — Specification

> **Monorepo.** This project lives in `specs/` in the CMI Auctions monorepo. The canonical setup
> is the [root README](../README.md).

This folder is the **specification** for CMI Auctions: a confidential, multi-unit, pay-as-bid,
first-price sealed-bid auction for selling quotas of tokenized RWAs on Stellar/Soroban.

The specification is the source of truth for behavior. The implementation that follows it lives in
the same repository:

| Where | What it implements |
|---|---|
| [`../contracts/`](../contracts/) | Soroban contracts, Noir circuits, artifacts, deploy scripts |
| [`../sdk/`](../sdk/) | TypeScript protocol (crypto, proofs, encoding, chain client) |
| [`../operator/`](../operator/) | the service that discovers, closes, allocates, and settles markets |
| [`../web/`](../web/) | the seller, bidder, and public app |

When behavior has to change, the spec/ADR changes **first**, in its own change; the implementation
follows.

## Start here

1. [`AGENTS.md`](AGENTS.md) — mission, reading order, and working rules
2. [`docs/PRODUCT.md`](docs/PRODUCT.md) — goal, users, MVP guarantees
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the protocol is divided
4. [`docs/CRYPTO.md`](docs/CRYPTO.md) — commitments, envelopes, Poseidon2, circuits
5. [`docs/SECURITY.md`](docs/SECURITY.md) — threat and trust model
6. [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) — what was decided and what was left out
7. [`docs/PRODUCT-ROADMAP.md`](docs/PRODUCT-ROADMAP.md) — product phases and evolutions
8. [`user-history/quota-auction-journey.md`](user-history/quota-auction-journey.md) — the same
   journey without cryptography, the product-level source of truth

## What each folder holds

| Folder | Role |
|---|---|
| `docs/` | product, architecture, cryptography, security, roadmap, open questions |
| `specs/` | executable behavior for requirements **RF-01..RF-22** |
| `adr/` | 27 frozen architecture decisions (`ADR-001`..`ADR-027`) |
| `user-history/` | the user journey, with no technical detail |
| `POC/` | artifacts from the spike that validated the Confidential Token live (POC-5) |

The `Status`/`Owner` fields in the specs and the former `plans/` belong to the specification phase
and were retired. Implementation progress is the state of the code in this monorepo — every project
has its own README and tests.

## Critical rule

Do not implement the full auction before the blocking spikes are green. They are: UltraHonk on
Soroban, envelope consistency, confidential collateral linkage, the multi-unit allocation proof,
atomic confidential settlement, and standardized Poseidon2. Each has an ADR and evidence in
`POC/`/`docs/OPEN_QUESTIONS.md`.

## MVP trust assumption

The public **never** sees a bid price — winner or loser, before or after settlement — nor an
individual payment amount, nor a clearing price, because the design is pay-as-bid.

The operator is the platform's automated backend, never the seller and never a bidder
([`ADR-021`](adr/ADR-021-operator-is-platform.md)). In the MVP it **sees** prices from the moment
collateral is locked: it is the collateral spender and the token auditor
([`ADR-024`](adr/ADR-024-mvp-business-and-trust-decisions.md) D2/D3). It **cannot act** on what it
sees: allocation is proven on-chain, and every settled amount is bound by a settlement proof
([`ADR-023`](adr/ADR-023-settlement-binding-and-spender-refund.md)).

The MVP is **testnet only**. OpenZeppelin's Confidential Token is still in developer preview and
has not been audited; mainnet is out of scope.

## Version

Specification pack **v3** — multi-unit, pay-as-bid, first-price sealed-bid auction; UltraHonk/Noir
proving system; settlement reusing Stellar's Confidential Token directly. Product decisions are in
`ADR-024` (D1–D22), the 10% house fee is in `ADR-026`, and no open decision remains (`OQ-22` was
closed in `ADR-024` D20).
