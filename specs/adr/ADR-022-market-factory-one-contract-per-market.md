# ADR-022 — One Auction Contract per market, deployed via a Market Factory

## Context
OQ-10 (see `docs/OPEN_QUESTIONS.md`, ADR-018's update) confirmed against the Confidential Token's real source that a single (owner, spender) pair can hold at most one live delegation — `set_spender` reverts with `DelegationAlreadyExists` on a second call for the same pair. Since the Auction Contract's own address is the "spender" a participant delegates collateral to, a single shared Auction Contract instance cannot safely serve more than one concurrently-open market: a participant bidding in two markets at once would collide on their second `set_spender` call.

## Decision
Introduce a **Market Factory** contract, deployed once for the whole platform. Creating a market means:

1. the seller calls the Factory's `create_market()` with the market config;
2. the Factory allocates the next platform-wide `market_id` (a global monotonically increasing `u64` — this supersedes the contract-scoped counter in ADR-015);
3. the Factory deploys a fresh Auction Contract instance from an already-uploaded WASM hash (cheap: no bytecode re-upload, only a new contract address) and passes it `market_id` plus the seller's config at construction;
4. the Factory records `market_id -> auction_contract_address` in its own registry, for discovery/indexing.

Every deployed Auction Contract instance serves exactly one market, for its entire lifecycle. `market_id` is immutable config set once at construction by the Factory — the instance itself never allocates or increments it.

The Verifier Adapter (per circuit type) and the Confidential Token remain single, shared, platform-wide deployments — this constraint is specific to the Auction Contract's identity as a collateral spender, not to every contract in the system. This mirrors `stellar-confidential-token-demo`'s own factory: it deploys new token instances while its verifier and auditor stay constant across every deployment.

## Consequences
Pros:
- resolves OQ-10 with an actual deployment topology, not just a documented constraint;
- reuses a pattern (factory-deployed instances from one WASM hash) already proven in the Confidential Token demo this project integrates with;
- keeps each Auction Contract instance simple — no multi-market bookkeeping, no risk of one market's state leaking into another's.

Cons:
- discoverability/indexing now depends on the Factory's registry being correct and available — a market whose Factory entry is lost is still safe (funds are never at risk, per the existing liveness guarantees) but becomes hard to find;
- slightly more deployment machinery than a single always-on contract, though Soroban's per-instance deployment cost from an existing WASM hash is low.

## Forbidden
Do not let an Auction Contract instance serve more than one market. Do not let an Auction Contract instance allocate its own `market_id` — it must come from the Factory at construction. Do not redeploy the Verifier Adapter or the Confidential Token per market — only the Auction Contract needs a fresh instance per market.

## Update — each instance is a confidential account (, ADR-023)
Each Auction Contract instance registers itself as a Confidential Token account from its constructor, so it can be the bidders' collateral spender. The `settlement_binding` verifier is a shared, platform-wide deployment like the other verifier adapters.
