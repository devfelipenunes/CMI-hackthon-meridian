# CMI Auctions — Specification (specs)

> **Monorepo.** This project lives in `specs/` in the CMI Auctions monorepo. The canonical setup is the [root README](../README.md).

This repository (`specs`) is the implementation specification for a confidential, multi-unit, pay-as-bid, first-price sealed-bid RWA quota sale on Stellar/Soroban.

**Implementation happens elsewhere.** It happens in the implementing repository (e.g. `contracts`), following that repository's own development roadmap and skills, where progress is tracked per step and per RF. This repository changes only when a spec or a decision changes.

It is intentionally split into small, executable documents instead of one monolithic PRD.

## Start here

1. `AGENTS.md`
2. `docs/PRODUCT.md`
3. `docs/ARCHITECTURE.md`
4. `docs/CRYPTO.md`
5. `docs/SECURITY.md`
6. `docs/OPEN_QUESTIONS.md`
7. `docs/PRODUCT-ROADMAP.md` — product roadmap (phases and future evolutions). The implementation roadmap lives in the implementing repository
8. `user-history/quota-auction-journey.md` — the non-technical user journey this whole pack implements

## Repository contract

- `docs/` describes stable product, architecture, cryptography, security, roadmap, and unresolved questions.
- `specs/` defines executable behavior for RF-01 through RF-22.
- `adr/` freezes architectural decisions.
- `plans/` defines high-risk technical spikes and implementation sequences.
- `user-history/` describes the platform's behavior from a user's point of view, with no technical/cryptographic detail — the product-level source of truth `docs/` and `specs/` must stay consistent with.
- `diagrams/` holds visual reference material (`architecture.html`). Illustrative only — `docs/` and `specs/` remain authoritative if they ever diverge.
- `POC/` holds the executable validation plan for the open questions that specifically need running code (not just a decision or a calculation) to close — see `POC/PLAN.md`. This is Stage 0's concrete checklist; `plans/001` through `plans/006` remain the broader spike descriptions.
- `CMI-Auctions-Visao-Geral-MVP.docx` is the current non-technical overview (Portuguese): the system on one page, the functional requirements as a table, the MVP decisions and simplifications, and future evolutions.
- `CMI-Auctions-Resumo-Tecnico.docx` is a **historical snapshot** of the plan in Portuguese, taken before POC-5/POC-6 and ADR-023/024/025. Where it diverges, `docs/`, `adr/` and `specs/` are authoritative.
- `TASKS.md` and `CURRENT_TASK.md` are **legacy and frozen**. They were the multi-agent task board and handoff file of the specification phase, and are kept as a historical record. Do not update them. The `Status`/`Owner` fields in `specs/` and `plans/` are frozen for the same reason.

## Critical rule

Do **not** implement the full auction before the blocking technical spikes are green. They are green (plans 001–005 in REVIEW; plan 006 is out of the MVP).

## Recommended order

> Historical order from the specification phase. The implementation sequence to follow is the development roadmap of the implementing repository (e.g. `contracts`).

### Stage 0 — Resolve blockers

1. `plans/001-ultrahonk-spike.md`
2. `plans/002-bid-envelope-consistency.md`
3. `plans/003-collateral-linkage.md`
4. `plans/004-winner-proof.md`
5. `plans/005-confidential-settlement.md`

### Stage 1 — Core market

Suggested implementation sequence:

```text
RF-02 → RF-03 → RF-01 → RF-04
RF-06 → RF-05
RF-07 → RF-08
RF-15 → RF-10 → RF-09
RF-12 → RF-13 → RF-14 → RF-11
RF-16 → RF-17 → RF-18 → RF-19
RF-20 (incl. release_unsettled) → RF-21 → RF-22
```

### Stage 2 — Optional integration (out of the MVP, ADR-024 D9)

6. `plans/006-zolvency-adapter.md`

## Important MVP trust assumption

The public never sees any bid price — winner or loser, before or after settlement — and never sees a single individual payment amount or the clearing price, because this is a pay-as-bid design.

The operator role is the platform's own automated backend, never the seller and never a bidder (ADR-021). In the MVP it can see bid prices from the moment collateral is locked (it is the collateral spender and the token auditor; ADR-024 D2/D3). It cannot act on that knowledge: allocation is verified by an on-chain ZK proof, and every settled amount is bound by a settlement-binding proof (ADR-023).

Every Stage-0 question is resolved, decided, or explicitly post-MVP, and was validated by six POCs, the last two live against the deployed Confidential Token (`POC/README.md`, `POC/results/SUMMARY.md`). Product decisions are in ADR-024 (D1–D22), and the 10% house fee is in ADR-026. No open decision remains (the last one, OQ-22, was decided in ADR-024 D20). The MVP targets **testnet only**. See `docs/OPEN_QUESTIONS.md`.

## Version

Specification pack **v3** (developed as a multi-agent pack until ; that workflow is now legacy) — multi-unit, pay-as-bid, first-price sealed-bid quota sale; UltraHonk/Noir proving system; settlement reuses Stellar's own Confidential Token directly.
