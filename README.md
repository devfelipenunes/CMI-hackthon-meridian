# CMI Auctions

**Confidential, multi-unit, pay-as-bid auctions for tokenized real-world assets — on Stellar.**

[Live demo](https://cmi-hackthon-meridian-web.vercel.app) · [Specs](specs/) · [Contracts](contracts/) · [SDK](sdk/) · [Operator](operator/) · [Web app](web/)

[![CMI Auctions — auction list](web/docs/screenshots/home.png)](https://cmi-hackthon-meridian-web.vercel.app)

*Testnet only. No real funds move.*

---

## Why this exists

Tokenization solves issuance. It does not solve distribution: selling a block of quotas to many
buyers at once leaks the one thing both sides want to keep — the price.

A public order book exposes the seller's demand curve and each buyer's strategy. A private
process keeps the price quiet, but asks everyone to trust the intermediary's arithmetic.

CMI Auctions separates the two:

> **Private information. Public verification. Deterministic settlement.**

Bidders seal a price and a quantity. The contract verifies, in zero knowledge, that the auction
was run on the real bids — without ever learning a price. The public sees demand and proofs, not
prices.

## What it does

- **Multi-unit, first-price, sealed-bid.** A seller offers `N` identical quotas; many bidders
  compete at once.
- **Pay-as-bid.** Each winner pays exactly the price they bid. There is no single clearing price
  to leak.
- **Public floor, public demand.** The reserve price and the requested quantities are public.
  Prices never are.
- **Fully collateralized.** A bid locks `price × requested_quantity` before it is accepted.
- **ZK-verified allocation.** The operator cannot add, remove, or reorder bids.
- **Confidential settlement, one bid per transaction.** No loop over the market, so one stuck
  bidder cannot block everyone else.
- **Permissionless exits.** Anyone may close, finalize within the window, settle a bid, or cancel
  an expired market.

The MVP runs on **Stellar Testnet**, pays in **XLM**, accepts **at most 8 bids per market**, and
requires **no KYC**.

## One auction, end to end

1. **The seller opens the market.** It sets the quota supply, a public floor price, a close date
   (at most 30 days out), and a small XLM fee reserve. The whole supply moves into escrow.
2. **A bidder seals a bid.** The frontend encrypts `(price, blinding, nullifier_seed)` and derives
   a commitment. The bidder submits the commitment, the requested quantity, a nullifier, and a
   `bid_validity` proof. The contract checks the proof and locks the collateral — without seeing
   the price.
3. **The market closes.** At `close_ledger`, anyone may close it. Bids freeze; the contract
   computes a Merkle root over the commitments.
4. **The operator judges.** It decrypts the envelopes, computes the allocation (highest price
   first, first-come tie-break at the margin), and submits a `winner_allocation` proof. The
   contract accepts the fills only if the proof verifies.
5. **Each bid settles.** For every bid, the operator assembles three Confidential Token legs —
   payment to the seller, the 10% house fee, and the refund — and a `settlement_binding` proof
   binds all three to the same bid commitment. Anyone can submit it.
6. **Timeout.** If nobody finalizes in time, anyone may cancel; each bidder is refunded through
   the same per-bid path.

The invariant behind all of it: **the price never becomes public state.** It lives in the
encrypted envelope, in the bidder's witness, and in the proof.

## Who sees what

| Actor | Sees | Does not see |
|---|---|---|
| **Public** | market, seller, quantities, floor, fills, proofs | any price, any payment amount, the clearing result before finalization |
| **Seller** | each winner's payment after settlement (it decrypts its own transfers) | losers' prices |
| **Operator** (platform backend) | bid prices from the moment collateral is locked — it is the collateral spender and the token auditor | cannot change the outcome: allocation and settlement are ZK-proven |
| **Stellar** | commitments, encrypted envelopes, nullifiers, proofs | prices |

The operator is the platform's own backend — never the seller, never a bidder. Its visibility is
an explicit MVP trade-off (ADR-024 D2/D3); its *power* is bounded by the proofs. The Confidential
Token is still in developer preview and has not been audited. This is why the deployment is
testnet-only.

## Architecture

```text
                        ┌────────────────── CMI Auctions ──────────────────┐
 Seller ──create/open──►│ Factory ──deploy──► Auction (1 per market)       │
                        │ ids, registry       lifecycle · bids · finalize  │
 Bidder ──submit_bid───►│                     settle (1 tx per bid)       │
                        └──────────────────────────┬──────────────────────┘
                                                   │ verify_proof
                         ┌─────────────────────────┼─────────────────────────┐
                         ▼                         ▼                         ▼
                  UltraHonk ×3             Confidential Token          Quota asset
                  bid_validity             (OpenZeppelin)              (Stellar SAC)
                  winner_allocation        collateral · payments
                  settlement_binding       refunds · house fee

 Operator (Node daemon) ── discovers markets, schedules by ledger, decrypts bids,
                           proves the allocation, builds each settlement ──►
```

| Component | Where | Role |
|---|---|---|
| **Factory** | [`contracts/contracts/factory`](contracts/contracts/factory) | Allocates `market_id`, deploys one Auction per market, keeps the registry |
| **Auction** | [`contracts/contracts/auction`](contracts/contracts/auction) | Escrow, bids, close, verified allocation, per-bid settlement |
| **Circuits** | [`contracts/circuits`](contracts/circuits) | Three Noir circuits: `bid_validity`, `winner_allocation`, `settlement_binding` |
| **UltraHonk verifier** | [`contracts/wasm`](contracts/wasm) | Pinned third-party WASM; `verify_proof` with the VK fixed at deploy |
| **Confidential Token** | [`contracts/wasm`](contracts/wasm) | OpenZeppelin token + verifier + auditor, pinned and deployed by CMI |
| **TypeScript SDK** | [`sdk/`](sdk/) | Protocol once: crypto, proofs, encoding, typed chain client |
| **Operator** | [`operator/`](operator/) | Node daemon: discovery, ledger schedule, keys, settlement, API |
| **Web app** | [`web/`](web/) | React/Vite: company, investor, and public views; proofs in the browser |

## Repository map

| Path | What is here |
|---|---|
| [`contracts/`](contracts/) | Soroban contracts, Noir circuits, versioned WASMs/VKs, proof fixtures, deploy scripts |
| [`sdk/`](sdk/) | TypeScript workspace: `core`, `client`, `operator`, `artifacts`, `testing`, examples, E2E |
| [`operator/`](operator/) | The always-on Node service that closes, judges, and settles markets |
| [`web/`](web/) | The SPA: company mode, investor mode, public auction view, and wallet integration |
| [`specs/`](specs/) | Product, RF-01..RF-22 requirements, ADRs, crypto and security docs, user journey |
| [`scripts/`](scripts/) | Monorepo helper that re-creates the sibling links |
| [`sdk/third_party/`](sdk/third_party/) | Pinned OpenZeppelin Confidential Token demo (git submodule, MIT) |

The four projects used to live in separate repositories. They now share one tree; committed
symlinks (`sdk/contracts`, `sdk/specs`, `web/sdk`, `web/specs`, `contracts/specs`) let each project
keep its sibling-relative paths. [`scripts/link-subprojects.sh`](scripts/link-subprojects.sh)
re-creates them if needed.

## Run it locally

### Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 22 | SDK, operator, web |
| pnpm | 10.34.6 (via corepack) | SDK, operator, web |
| Rust | 1.98.1 + `wasm32v1-none` | contracts |
| `soroban-sdk` | 26.0.1 (resolved 26.1.1, in `Cargo.lock`) | contracts |
| `stellar-cli` | 26.1.0 | contract build/deploy only |
| `nargo` | 1.0.0-beta.9 | circuits |
| `bb` | 0.87.0 | circuits, proofs |
| `jq` | 1.6+ | contract scripts |

### 1. Clone

```bash
git clone --recurse-submodules https://github.com/devfelipenunes/CMI-hackthon-meridian.git cmi
cd cmi
./scripts/link-subprojects.sh   # no-op on a fresh clone; re-creates the sibling links
```

### 2. SDK (the protocol)

```bash
cd sdk
corepack enable
pnpm install
pnpm test          # 665 tests: unit, parity, circuits
```

### 3. Web app

The frontend reads the SDK straight from the workspace, so install the SDK first.

```bash
cd web
pnpm install
pnpm dev           # http://localhost:5173
```

It reads [`web/app/public/config/testnet.json`](web/app/public/config/testnet.json), which is
already pinned to a live testnet deployment. Connect Freighter on **Testnet**, or start with
`VITE_DEV_WALLET=1 pnpm dev` to use the in-memory dev wallet.

### 4. Operator

```bash
cd operator
./scripts/setup-sdk.sh      # SDK build + unit tests, then this project's install
cp .env.example .env
pnpm cli init-master        # data/master.key — keep it out of the database
pnpm start                  # API + keeper; Swagger at http://127.0.0.1:8080/docs
```

The operator needs the deployment file and its keys; the full bootstrap is in
[`operator/docs/RUNBOOK.md`](operator/docs/RUNBOOK.md) §1.

### 5. Contracts (optional: only to rebuild or redeploy)

```bash
cd contracts
./scripts/verify.sh         # tool versions, fmt, clippy, Rust + Noir tests, artifacts, WASMs
./scripts/build.sh          # optimized WASMs
./scripts/deploy-testnet.sh --network quickstart --auditor-key <128 hex>
```

## Verification

Every suite below was run on **2026-10-26** while preparing this README:

| Layer | Command | Result |
|---|---|---|
| Contracts | `cd contracts && cargo test` | **200 passed**, 3 ignored |
| Circuits | `cd contracts/circuits && nargo test` | **52 passed** |
| SDK | `cd sdk && pnpm test` | **665 passed** (75 files) |
| Operator | `cd operator && pnpm test` | **85 passed** (10 files) |
| Web | `cd web && pnpm test` | **95 passed** (17 files) |
| Full auction, real token | `contracts/e2e/` evidence + `cd sdk && pnpm e2e` | requires a network and the operator |

The contracts integration tests use real UltraHonk proofs and real WASMs, not mocks. End-to-end
evidence with the live Confidential Token is committed under [`contracts/e2e/`](contracts/e2e/).

## Status

| Area | State |
|---|---|
| Contracts and circuits | Implemented; deployed on Stellar Testnet |
| TypeScript SDK | Implemented; 5 packages + examples; 665 tests |
| Operator daemon | Implemented; discovery, ledger scheduling, keys, settlement, HTTP API; 85 tests |
| Web app | Implemented; live on Testnet; 95 tests |
| Full auction with the real token | E2E evidence committed per release candidate |

Known limitations of the MVP (deliberate, not bugs):

- **Testnet only.** The OpenZeppelin Confidential Token is a developer preview and unaudited.
- **The operator must be online.** If it stops, automatic finalization and refunds stop; bidders
  can still exit with `revoke_spender`.
- **The operator sees bid prices from lock time.** Accepted and documented in ADR-024.
- **One key in the operator database.** No HSM/TEE yet.
- **The envelope key is the POC constant**, so envelopes are readable on-chain in this build.
- **At most 8 bids per market** (`MAX_BIDS = 8`).
- **No KYC.** Eligibility gating is disabled by default and pluggable later.

## Documentation

| Start here | What it covers |
|---|---|
| [`specs/docs/PRODUCT.md`](specs/docs/PRODUCT.md) | Product goal, users, guarantees |
| [`specs/docs/ARCHITECTURE.md`](specs/docs/ARCHITECTURE.md) | Protocol architecture |
| [`specs/docs/CRYPTO.md`](specs/docs/CRYPTO.md) | Commitments, envelopes, Poseidon2, circuits |
| [`specs/docs/SECURITY.md`](specs/docs/SECURITY.md) | Threat model and trust assumptions |
| [`specs/specs/`](specs/specs/) | RF-01..RF-22, the executable requirements |
| [`specs/adr/`](specs/adr/) | 27 architecture decision records |
| [`specs/user-history/quota-auction-journey.md`](specs/user-history/quota-auction-journey.md) | The same flow, with no cryptography |
| [`contracts/README.md`](contracts/README.md) | On-chain layer, circuits, costs, invariants |
| [`sdk/README.md`](sdk/README.md) | SDK packages and development flow |
| [`operator/README.md`](operator/README.md) | The service that runs the auction |
| [`web/README.md`](web/README.md) | The frontend and its scripts |

## Hackathon

Built for **HackMeridian** (Stellar). The specification phase closed every blocking technical
spike first — UltraHonk on Soroban, envelope consistency, collateral linkage, allocation proof,
and atomic confidential settlement — and the MVP implements that validated design. The phase plan
and post-MVP roadmap are in
[`specs/docs/PRODUCT-ROADMAP.md`](specs/docs/PRODUCT-ROADMAP.md).

## License

MIT. See [LICENSE](LICENSE).
