# CMI Auctions — Operator

The **operator** is the service that makes a confidential RWA quota auction happen on
Stellar/Soroban. It runs on its own, all the time, and is the only participant able to close,
judge, and settle a market (ADR-024 D12).

It is not a frontend and not a wallet: it is a **Node/TypeScript daemon** that watches the chain,
decides each market's next step, and signs the transactions.

```
      seller / bidders                        administrator
            │                                       │
            │  GET /v1/register-data                │  API key
            └──────────────────►┌──────────────┐◄───┘
                                │   operator   │
                                │ Fastify+API  │
                                │ discovery    │
                                │ scheduler    │
                                │ executor     │
                                │ keystore     │
                                └──────┬───────┘
                                       │ signs as submitter
                    ───────────────────▼───────────────────
                    Stellar RPC · Factory · Auction · Token
```

---

## What the service does

| It does | Why |
|---|---|
| **Discovers** every new market by scanning the Factory, with no notification | A market can be created by any seller at any time (RF-02) |
| **Tracks** each market by the network ledger | Auction windows are counted in ledgers, not hours (RF-21) |
| **Closes** the market at `close_ledger` | After that, no bid enters (RF-16) |
| **Decides the winners**: decrypts envelopes, checks proofs, computes the allocation, proves the result | Only the operator has `sk_op` to open bids (RF-17..RF-19) |
| **Pays**: settles each bid — seller, fee, refund, quotas — one per ledger | Settlement is heavy and limited to one per ledger (RF-20, ADR-026) |
| **Closes what cannot settle** and **cancels on timeout** | A stuck auction must end, not hang (RF-19, RF-20) |
| **Stores the operator keys** encrypted | The service needs them in memory to sign (ADR-024 D5) |
| **Exposes an API** to observe and operate | State, markets, actions, alerts, and the `register_data` the seller uses |

The protocol — cryptography, proofs, encoding, call order, keeper rule — **does not live here**. It
comes from the SDK (`@zolvency-cmi/operator`). This project hosts the process: scheduling,
persistence, keys, and alerts (S-12 of the SDK).

---

## The central idea

Three principles explain almost the entire design:

1. **The chain is the truth.** The database is an index, a schedule, and an audit trail. Every
   decision is made on state re-read from the chain; if the database and the chain diverge, the
   chain wins (OP-05).
2. **Time is ledger, not clock.** `close_ledger` and `finalize_by_ledger` are known when the market
   is created and never change. The service wakes on every ledger and acts only on markets whose
   time has come (OP-04).
3. **The operator does not publish prices.** It knows every price — it is the one who decrypts
   them — but no route, log, or alert returns them, not even to the administrator (OP-16).

Everything else follows: why not cron, why settlement is one per ledger, why discovery does not use
events. Each choice is recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

---

## How to run it

The operator consumes the **SDK** and the deployment through sibling paths:

```
cmi/
├── operator/   ← this project
├── sdk/        protocol in TypeScript
├── specs/      product, RFs, and ADRs
└── contracts/  on-chain interface and artifacts
```

```bash
./scripts/setup-sdk.sh    # submodules, SDK build and tests, then install here
cp .env.example .env      # adjust CMI_NETWORK and the API keys
pnpm cli init-master      # data/master.key — keep it separate from the database
pnpm start                # starts the API + keeper loop
```

Swagger UI at `http://127.0.0.1:8080/docs` (header `x-api-key`).

The full sequence — keys, platform deployment, fee wallet, first start — is in
[docs/RUNBOOK.md](docs/RUNBOOK.md) §1.

```bash
pnpm lint       # eslint + dependency-cruiser + typecheck
pnpm test       # unit + integration + api
pnpm test:e2e   # local network (requires Docker) or testnet
```

---

## What it needs to start

| Piece | Where it comes from |
|---|---|
| **Deployment** | `deployments/<network>.json` — RPC, passphrase, Factory, token, and auditor addresses |
| **Master key** | file with 600 permissions (or an environment variable); encrypts the `keys` table |
| **Operator keys** | `spender` (`sk_op`), `envelope`, `submitter`, `fee_wallet_*`; generated/imported by the CLI |
| **API keys** | `read` and `admin`, stored as sha256 in the environment |

Before operating, boot checks the network, artifacts (sha256), keys, and fee wallet. If anything is
wrong, the process **does not start** — and it never prints a secret value (OP-13).

The testnet deployment is already in [`deployments/testnet.json`](deployments/testnet.json): eight
contracts deployed, with each WASM's hash and the circuit VKs.

---

## Current state

| Area | Status |
|---|---|
| Config, logger, database, keystore, CLI | Implemented |
| Discovery, sync, scheduler, per-ledger loop, lease | Implemented |
| Close, finalize, settle, timeout, alerts | Implemented |
| HTTP API (status, markets, actions, alerts, operations, `register_data`) | Implemented |
| End-to-end auction | Written; runs against a local network (Docker) or testnet |

Conscious MVP limitations, not bugs:

- The envelope key is the POCs' key — anyone can read the envelopes on-chain (OP-10).
- A quarantined bid is only retried after the service restarts (OP-19).
- Keys in the database, no HSM (ADR-024 D5).
- Operator down = auctions stopped (ADR-024 D12).

---

## Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the service is divided, how it schedules by ledger, a market's flow, concurrency, and security |
| [docs/API.md](docs/API.md) | External and internal contract: routes, configuration, database schema, modules, CLI, and errors |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Why each choice was made (OP-01..OP-22), with rejected alternatives |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Operations: first start, local network, alerts, backup, upgrade |
| [docs/requests/](docs/requests/) | This project's requests to the contracts and the SDK |

## Sources of truth

`specs/` (product, RFs, ADRs), `sdk/` (TypeScript protocol), and `contracts/` (on-chain interface)
govern. When `docs/` contradicts any of them, they win — and `docs/` is fixed.

## License

MIT. See [LICENSE](LICENSE).
