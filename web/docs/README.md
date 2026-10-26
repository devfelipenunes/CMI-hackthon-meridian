# CMI Auctions — Frontend (web)

This repository is the **web frontend** of CMI Auctions: a confidential, multi-unit, pay-as-bid,
sealed-bid quota auction for tokenized RWAs on Stellar/Soroban.

**There is no backend of its own.** The frontend talks to the blockchain and generates ZK proofs
**only through the SDK** (`sdk`). It does not reimplement cryptography, encoding, witnesses, or call
order: it only composes the SDK, the wallet, and the screens.

| Who | Frontend mode | What they do | SDK package |
|---|---|---|---|
| **Company (seller)** | Company | registers the confidential account, creates the auction, locks the quotas (opens), cancels, tracks it, and reads proceeds | `client` (`seller`, `account`, `markets`) |
| **Investor (bidder)** | Investor | registers the confidential account, deposits XLM, places the sealed bid (2 proofs in the browser), tracks it, recovers collateral, merges the refund | `client` (`bidder`, `account`, `markets`) |
| **Public** | no wallet | sees the auctions, public demand, state, and result (never prices) | `client` (`markets`) |
| **Operator (platform)** | **another system**, outside this project | `finalize` with the `winner_allocation` proof and each bid's `settle`; it is the only one that sees prices. The frontend only shows progress through events | `operator` (Node only) |

**Network:** testnet, with the platform deployment configured in
[`app/public/config/testnet.json`](../app/public/config/testnet.json).

---

## Current state (2026-10-26)

- **Frontend implemented:** company, investor, public views, wallet integration, browser proofs,
  and the testnet scripts. `pnpm test` passes with **95 tests**; `pnpm test:browser` covers proofs and
  IndexedDB.
- **Live demo:** <https://cmi-hackthon-meridian-web.vercel.app> (testnet).
- **SDK:** ready for the frontend — confidential account in the browser (S-22) and RPC event window
  (S-23) on the SDK's `main`.
- **Testnet:** deploy live and checked.
- **Operator:** now lives in [`../../operator/`](../../operator/) in the same monorepo. Without it running,
  markets stop at `Closed` and may be cancelled by timeout; for local development, the SDK keeper
  can run inside the test.
- **If you are going to develop:** [root README](../README.md) (setup) → [AGENTS.md](../AGENTS.md) →
  [`cmi-front-tdd`](../.claude/skills/cmi-front-tdd/SKILL.md) → this index.

---

## Index

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layers, folders, how the SDK enters the app, each person's flow, security |
| [SCREENS.md](SCREENS.md) | Screens, states, and what each screen calls in the SDK |
| [TESTING.md](TESTING.md) | Frontend TDD strategy: levels, SDK fakes, testnet E2E |
| [ROADMAP.md](ROADMAP.md) | The steps and the **only source of status** |
| [DECISIONS.md](DECISIONS.md) | Frontend decisions (F-01..F-16), including **open** ones |
| [requests/](requests/) | This project's requests to the SDK (`001`: confidential account state) |

---

## Sources of truth

| Folder | Role |
|---|---|
| `../sdk/` (link) | **Governs business rules and the API.** `packages/{core,client,operator}` code and each package's README. On conflict with any document, the SDK code wins |
| `../contracts/` (link) | On-chain interface: functions, errors, events, artifacts |
| `../specs/` (link) | Product and journey (`user-history/quota-auction-journey.md`), RF-01..RF-22, ADRs. **May be out of date:** if it diverges from the SDK, the SDK wins |
| `docs/` (this folder) | **How and in what order** the frontend is built |

**Conflict rule.**
- `docs/` contradicts the SDK code → the SDK wins, and `docs/` is fixed in the same commit.
- The frontend needs something the SDK does not offer → **do not reimplement it**: file a request in
  `docs/requests/`, make the change **in the SDK** (F-14); `sdk/` is a link to the same tree, so the
  change is visible here immediately.
- **Do not edit the sibling projects from here.** `sdk/`, `specs/`, and `contracts/` are links to the
  single copy in the monorepo; a change to them belongs to their own project and flow.

---

## Workflow

Unlike the SDK (phases → one PR per step), the frontend was developed **all at once**, in a single
phase (F-15). It is now on `main`; new changes use a short-lived feature branch and a PR to `main`.

```text
feature branch  ──commits per step (red test, then green)──►  PR to main
```

- Every [ROADMAP](ROADMAP.md) step still starts with tests (TDD) and a "Done when".
- Commits: `type(scope): description`. The red-test commit is separate from the implementation
  commit.
- Step order follows dependencies. Independent steps can run in parallel.

## Rules for every commit

1. **TDD:** no production code without a failing test first ([TESTING.md](TESTING.md)).
2. **Only the SDK speaks the protocol.** No formula, hash, witness, or encoding in the frontend.
   The exception is classic Stellar operations the SDK does not cover (trustline, public XLM
   balance, friendbot), done with `@stellar/stellar-sdk` at the SDK's version (14.6.1).
3. **No secret leaks:** price, `price × qty`, keys, and openings never go into a URL, `localStorage`,
   logs, telemetry, error messages, serialized caches, or persisted global state. Price exists only
   in memory, during the bid (F-11).
4. **The `operator` package and `packages/testing` never enter the app bundle** (S-02 of the SDK).
   Lint and a bundle test enforce this.
5. **Values are `bigint`** (XLM in stroops, quotas in base units). `number` is only for counts,
   ledgers, and `bid_index`.
6. **The wallet signs.** The app never asks for or stores the user's Stellar key (except the
   development wallet, F-05).
7. **The bid order is the SDK's:** `prepareBid` (proofs, nothing locked) → confirmation →
   `placeBid` (`set_spender` → `submit_bid`).
