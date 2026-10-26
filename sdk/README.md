# CMI Auctions — TypeScript SDK

TypeScript SDK for **CMI Auctions**: a confidential, multi-unit, pay-as-bid, sealed-bid quota
auction for tokenized RWAs on Stellar/Soroban, with UltraHonk/Noir proofs.

This project is part of the CMI Auctions monorepo. The [root README](../README.md) covers the
product and the full setup; this one covers the **TypeScript protocol** — the layer the frontend
and the operator consume so that neither reimplements cryptography, encoding, or call ordering.

## Packages

| Package | What it provides | Runs in |
|---|---|---|
| [`@zolvency-cmi/core`](packages/core/) | Poseidon2, Grumpkin, commitment, nullifier, root, ECDH envelope, allocation, UltraHonk proofs, Confidential Token, `ChainClient` | Node and browser |
| [`@zolvency-cmi/client`](packages/client/) | Bidder and seller: confidential account, deposit, `prepareBid`/`placeBid`, status, proceeds | Node and browser |
| [`@zolvency-cmi/operator`](packages/operator/) | Keeper, bid reading, allocation, settlement, `release_unsettled` | **Node only** |
| [`@zolvency-cmi/artifacts`](packages/artifacts/) | Circuits (ACIR) and VKs for a contracts release, verified by SHA-256 | Node and browser |
| [`@zolvency-cmi/testing`](packages/testing/) | Test doubles, scenarios (`AURORA`), localnet, `assertNoSecretLeak` | tests only |

There are also two runnable examples: [`examples/bidder-web`](examples/bidder-web/) (bidding in
the browser) and [`examples/operator-node`](examples/operator-node/) (a Node keeper).

## Development

Requirements: Node 22 and pnpm 10.34.6 (`corepack enable`).

```bash
cd sdk
pnpm install
pnpm lint          # eslint + package boundaries + typecheck
pnpm test          # 665 tests: unit, parity, circuits
```

Other test projects, when the path requires them:

```bash
pnpm test:proving      # real proofs
pnpm test:browser      # Chromium (bb.js, IndexedDB)
pnpm test:integration  # local network
pnpm test:examples     # bundle and examples
pnpm test:release      # release artifacts
pnpm e2e --contracts v0.1.0 --network testnet --round all
```

The E2E suite has its own README: [`e2e/README.md`](e2e/README.md).

## Sources of truth

| Source | What it governs |
|---|---|
| [`../specs/`](../specs/) (link) | product, RF-01..RF-22, ADRs, and security invariants |
| [`../contracts/`](../contracts/) (link) | on-chain interface, parity vectors, published artifacts |
| [`packages/*/README.md`](packages/) | each package's public API, with examples |

The flow is TDD: red test, implementation, one step per PR. The working rules, the POC reuse map,
and the guardrails (`noir_js`/`bb.js` versions, keccak transcript, `bigint`, `Secret<T>`, the
`operator` package kept out of the browser bundle) live in the
[`.claude/skills/cmi-sdk-tdd`](.claude/skills/cmi-sdk-tdd/SKILL.md) skill.
