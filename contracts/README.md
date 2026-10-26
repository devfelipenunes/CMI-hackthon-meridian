# CMI Auctions — Confidential Auctions on Stellar

> **Monorepo.** This project lives in `contracts/` in the CMI Auctions monorepo. The
> [root README](../README.md) covers the product and the full stack.

CMI Auctions sells tokenized RWA quotas through a **confidential, multi-unit, pay-as-bid,
sealed-bid auction** on Stellar/Soroban. A bidder commits to a price and a quantity without
revealing either. The operator later proves, in zero knowledge, who won and what each winner
pays. The chain sees commitments and proofs — never a bid price.

This repository is the on-chain layer: two Soroban contracts (`factory`, `auction`), three
Noir/UltraHonk circuits (`bid_validity`, `winner_allocation`, `settlement_binding`), and the
published artifacts that the SDK, the operator and the frontend consume.

---

## One auction, end to end

A seller has `N` identical quotas and wants to sell them without exposing the demand curve.
A bidder wants to bid without revealing a price to competitors or to the public mempool.

**1. Seal the bid.** The frontend encrypts `(price, blinding, nullifier_seed)` into an
envelope and derives a commitment. The bidder submits the commitment, the requested quantity,
a nullifier and a `bid_validity` proof. The contract stores the envelope and verifies that
the commitment is consistent, that the price is at least the reserve, that the bidder is
eligible and that its collateral delegation covers the whole auction — all without seeing the
price. A nullifier is consumed, so the same bid cannot be replayed.

**2. Close.** At `close_ledger`, anyone may close the market. The contract freezes the bids,
computes a Merkle root over the commitments and opens the finalization window.

**3. Judge.** During the window, anyone may submit a `winner_allocation` proof. The circuit
proves the allocation itself: given the committed prices and quantities, these are the
winners, this is the clearing price, no fill exceeds what was requested or supplied, and the
margin is rationed correctly. The contract accepts the filled quantities only if the proof
verifies.

**4. Settle, one bid at a time.** For each bid, the operator assembles three confidential
token legs — payment to the seller, the platform fee and the refund — and a
`settlement_binding` proof binds all three to the same bid commitment. Anyone can submit it.
Settlement is per bid by design: no call loops over the market, so one stuck bidder cannot
block everyone else.

**5. Timeout.** If nobody finalizes before `finalize_by_ledger`, anyone may cancel the market;
each bidder is still refunded through the same per-bid settlement path.

The invariant behind all of it: **the price never becomes public state**. It lives in the
envelope, in the bidder's witness and in the proof.

---

## How privacy is enforced

| Mechanism | What it hides | Where it lives |
|---|---|---|
| Commitment | the bid contents | stored per bid; leaves of the Merkle root |
| Encrypted envelope | price, blinding, nullifier seed | on-chain, opaque without the bidder's key |
| Nullifier | double bidding | consumed once per bid; reuse is rejected |
| ZK proof | the link between bidder, price and outcome | verified on-chain; the witness never leaves the prover |
| Public inputs from state | caller-supplied lies | root, quantities and config hash come from storage |

The contracts never trust the caller with a value that can be read from the market. The
circuits never reveal a price. The operator learns the bids because it builds the allocation
and the settlement payloads; the chain and the public do not.

---

## Architecture

```text
                        ┌───────────────────────── this repository ──────────────────────────┐
                        │                                                                     │
  seller ── create ───► │  Factory (1 per platform)                                           │
                        │    • market_id global  • registry market_id → address               │
                        │    • deploy of 1 Auction per market (ADR-022)                       │
                        │                 │ deploy                                            │
                        │                 ▼                                                   │
  bidder ── bid ──────► │  Auction (1 per market)                                             │
  operator ─ finalize ► │    market.rs      lifecycle, deadlines, cancellation                │
  keeper ─── settle ──► │    bidding.rs     participants, bids, nullifiers, root              │
                        │    settlement.rs  settle / release_unsettled per bid                │
                        │         │                 │                   │                     │
                        └─────────┼─────────────────┼───────────────────┼─────────────────────┘
                                  │                 │                   │
                    verify_proof  ▼                 ▼ set_spender /     ▼ transfer
            ┌───────────────────────────┐  ┌──────────────────────┐  ┌───────────────────┐
            │ UltraHonk Verifier ×3     │  │ Confidential Token   │  │ Quota asset (SAC) │
            │ bid / allocation /        │  │ (OZ, CMI's own       │  │ XLM SAC (reserve) │
            │ settlement (fixed VK)     │  │  deploy, ADR-024 D3) │  │                   │
            └───────────────────────────┘  └──────────────────────┘  └───────────────────┘
                 Third-party WASM, pinned in wasm/ (not reimplemented here)
```

| Component | Instances | Code | Role |
|---|---|---|---|
| **Factory** | 1 per platform | `contracts/factory` | Allocates `market_id`, deploys each Auction, keeps the registry |
| **Auction** | 1 per market | `contracts/auction` | Escrow, bids, close, verified allocation, settlement |
| **UltraHonk Verifier** | 3 per platform (1 per circuit) | `wasm/` (rs-soroban-ultrahonk, unmodified) | `verify_proof(public_inputs, proof)` with the VK fixed at deploy |
| **Confidential Token + verifier + auditor** | 1 set per platform | `wasm/` (OpenZeppelin @ `539968f`) | Confidential collateral in XLM, payments and refunds |
| **Quota asset** | 1 per market (from the seller) | external (SAC) | The quota sold: 1 quota = 10^7 base units |

### Market lifecycle

```text
Factory.create_market ──► CREATED ──open_market──► OPEN ──close_market──► CLOSED ──finalize──► FINALIZED
                             │                      │                      │                     │
                        cancel_market         close with 0 bids    cancel_expired       settle / release_unsettled
                             ▼                      ▼                      ▼                 (1 tx per bid)
                         CANCELLED              CANCELLED              CANCELLED                 ▼
                                                                    (refund via settle      SETTLED
                                                                     with filled = 0)
```

`open_market` moves the whole supply — `total_quotas × 10^7` base units — from the seller into
escrow. Everything after that is driven by ledgers and proofs, not by an owner:

| Step | Who calls it | What authorizes it |
|---|---|---|
| `create_market`, `open_market`, `cancel_market` | seller | seller signature |
| `register_participant`, `submit_bid` | bidder | bidder signature + `bid_validity` proof |
| `close_market`, `cancel_expired` | anyone | the deadline only |
| `finalize` | anyone (in practice, the operator) | the `winner_allocation` proof |
| `settle` | anyone (keeper) | the `settlement_binding` proof + payloads from the operator |
| `release_unsettled` | anyone | the token reporting that the delegation has ended |

Every transition that anyone can trigger reimburses the caller from a fee reserve, so a keeper
is paid for closing, finalizing, cancelling or settling.

### The three circuits

| Circuit | Prover | Verified by | What the proof states |
|---|---|---|---|
| `bid_validity` | bidder, in the frontend | `Auction.submit_bid` | The commitment matches a price above the reserve, the requested quantity, the nullifier, the envelope and the collateral binding |
| `winner_allocation` | operator, in the backend | `Auction.finalize` | These fills respect every requested quantity and the total supply, with the margin rationed correctly and the clearing price consistent |
| `settlement_binding` | operator, in the backend | `Auction.settle` | The seller, fee and refund legs are exactly `gross − fee`, `fee` and `price × (requested − filled)`, bound to the same commitment |

The Confidential Token circuits (`register`, `set_spender`, `spender_transfer`,
`revoke_spender`) belong to OpenZeppelin and are not in this repository. The public-input order and
the constraints are frozen by the circuits in `circuits/`.

### Cost

The full auction — eight bids, close, judging and eight settlements — measured in
`budget_full_auction`, with real proofs and storage growing on every call:

| Function | CPU | Memory | Cap |
|---|---|---|---|
| `submit_bid` (1st bid) | 82.927M | 4.36 MB | < 150M per transaction |
| `submit_bid` (8th bid) | 83.625M | 4.63 MB | same |
| `close_market` | 13.086M | 0.88 MB | — |
| `finalize` | 82.671M | 4.52 MB | < 100M per transaction |
| `settle` (1st settlement) | 85.186M | 5.00 MB | < 400M per transaction (guardrail 22) |
| `settle` (8th settlement) | 86.085M | 5.27 MB | same |

The cost rises from the first to the eighth bid because the `Vec` of `BidRecord` grows. These
figures use the test token, so they are a lower bound: on testnet with the real token, `settle`
cost 348.8M — the 400M cap still holds, but the valid number comes from the E2E with the real
token.

---

## Repository layout

```text
contracts/
├── contracts/
│   ├── factory/src/            # Factory: ids, registry, deploy
│   ├── auction/src/            # Auction: lifecycle, bidding, settlement, crypto
│   │   └── test/               # unit tests, one file per module + fakes
│   ├── auction/tests/          # integration tests: real WASMs and real proofs
│   └── shared/src/             # constants, config validation, shared types
├── circuits/                   # Noir workspace: cmi_lib + the three circuits
├── wasm/                       # pinned auction/token WASMs, VKs and PROVENANCE.md
├── artifacts/                  # generated and versioned: circuits, VKs, proofs, parity vectors
├── deployments/                # addresses per network, written by deploy-testnet.sh (quickstart.json is local)
├── e2e/                        # E2E evidence with the real token, one file per RC
└── scripts/                    # build, circuits, fixtures, deploy, release, verify
```

`target/`, `circuits/target/`, `test_snapshots/`, `deployments/quickstart.json` and `dist/`
are generated and gitignored. None of them is needed to run anything: the tools recreate them.

---

## Running it

| Tool | Version | Why it is pinned |
|---|---|---|
| Rust | 1.98.1, `wasm32v1-none` | the WASM bytes depend on rustc |
| `soroban-sdk` | `26.0.1` (resolved `26.1.1`) | the same one as the POCs; `Cargo.lock` pins the rest |
| `stellar-cli` | `26.1.0` | build, deploy and bindings |
| `nargo` | `1.0.0-beta.9` | newer versions emit ACIR that `bb 0.87.0` cannot read |
| `bb` | `0.87.0` | always `--scheme ultra_honk --oracle_hash keccak` |
| `jq` | 1.6+ | artifact paths and deployment JSON |
| `curl` | any | deploy only: ledger lookup and friendbot |

With those installed, one command checks the whole repository:

```bash
./scripts/verify.sh
```

It checks the pinned Rust version, formatting, clippy, the Rust and Noir tests, the versioned
circuit artifacts and the WASMs/VKs. The first run compiles from scratch (minutes); later runs
reuse the cache. `stellar-cli` is only needed for build and deploy.

Useful individual commands:

```bash
cargo test                              # contract unit + integration tests (real proofs)
cargo clippy --all-targets --all-features -- -D warnings

cd circuits && nargo test               # circuit unit tests
./scripts/circuits.sh                   # compile, generate VKs, write artifacts/
./scripts/fixtures.sh                   # regenerate the proof fixtures

./scripts/build.sh                      # optimized WASMs
./scripts/deploy-testnet.sh --network quickstart --auditor-key <128 hex>
./scripts/deploy-testnet.sh --network quickstart --check-deployment
./scripts/release.sh v0.1.0-rc.1        # release package for the SDK
```

---

## Artifacts and releases

This repository does not depend on any other repository in the project; the arrow points one
way:

```text
contracts  ──release vX.Y.Z──►  sdk (TS)  ──npm──►  frontend / backend
```

Each release publishes what the other layers need:

| Artifact | Used for |
|---|---|
| `factory.wasm`, `auction.wasm` | generating the TypeScript bindings |
| `artifacts/circuits/*.json` | generating proofs with `noir_js` + `bb.js 0.87.0` |
| `artifacts/vks/*.bin` | checking that the on-chain VK is the circuit's VK |
| `artifacts/parity-vectors/*.json` | proving that TypeScript computes commitment, nullifier, root, envelope and allocation the same as Rust/Noir |
| `deployments/testnet.json` | factory, verifier and token addresses |

A change to a circuit, to a public input or to a contract interface produces a new release.
Markets already created stay on the version they were created with; each Auction is immutable.

---

## Source of truth

The product and protocol documentation lives in [`../specs/`](../specs/): product docs,
RF-01..RF-22, ADRs and open questions.

---

## Invariants

1. **No price in the clear** — not in storage, not in an event, not in a public input.
2. **Public inputs come from state** — never from the caller.
3. **Frozen formats** — commitment, public-input order, Poseidon2 sponge and proof system only
   change with a new ADR.
4. **Settlement is per bid** — one transaction per bid, never a loop over the market.
5. **Failures are typed and atomic** — a failed call leaves no partial state.
6. **TDD** — the test comes first, and every security-relevant negative path has a test.

The full rules, branch flow and review process are in [`../specs/AGENTS.md`](../specs/AGENTS.md).
