# AGENTS.md — CMI Auction

## Mission

Implement **CMI Auctions**, a confidential, multi-unit, pay-as-bid, first-price sealed-bid protocol for selling quotas of tokenized RWAs on Stellar/Soroban.

This repository (`specs`) is the **specification** of CMI Auctions: product docs, requirements (`specs/`), decisions (`adr/`), plans and POCs. Agents implementing the protocol must work from these explicit specs, ADRs and plans rather than infer architecture from code alone.

**Where implementation happens.** Implementation, and the tracking of its progress, happens in the implementing repository (e.g. `contracts`), following that repository's own development roadmap and skills. This repository changes only when a spec or a decision changes (a new or updated ADR, spec, or product rule).

## Read order

Before any implementation work, read:

1. `docs/PRODUCT.md`
2. `docs/ARCHITECTURE.md`
3. `docs/CRYPTO.md`
4. `docs/SECURITY.md`
5. `docs/OPEN_QUESTIONS.md`
6. the relevant requirement in `specs/`
7. every ADR referenced by that requirement
8. `user-history/quota-auction-journey.md`, to check the behavior you're building still matches the product-level story

`TASKS.md` and `CURRENT_TASK.md` are **legacy** (see below): do not read them for current status.

If you have access to the `stellar-zkp-crypto` skill, consult it before writing or reviewing any circuit, choosing a proving system, or touching the Confidential Token integration.

## Task tracking (legacy)

The multi-agent task-ownership model used during the specification phase is **legacy**:
- task claiming;
- `Owner` fields;
- `CURRENT_TASK.md` handoffs;
- the `TASKS.md` board.

`TASKS.md`, `CURRENT_TASK.md` and the `Status`/`Owner` fields in `specs/` and `plans/` are frozen and must **not** be updated.

- **Progress:** implementation status (per step and per RF) lives in the implementing repository (e.g. `contracts`), following that repository's own development roadmap and skills.
- **Changes here:** only when the specification itself changes. In that case, update the spec/ADR/docs in the same change and keep the ADR guardrails below.

## Blockers

If a requirement depends on an item marked **BLOCKER** in `docs/OPEN_QUESTIONS.md`:

- do not invent an interface;
- do not silently choose a cryptographic construction;
- do not mock the dependency and mark the requirement complete;
- execute the corresponding spike/plan or stop and request a decision.

## Workflow

1. Read the relevant spec.
2. Check dependencies and blockers.
3. Inspect the related files listed in the spec. They are indicative, from the specification phase: the implementing repository defines its own file layout.
4. For multi-file or high-risk changes, plan the change in the implementing repository's own roadmap. `plans/` here is the record of the specification phase.
5. Implement the smallest complete change.
6. Run targeted positive and negative tests.
7. Run formatting/linting.
8. Run the full test suite if targeted tests pass.
9. If the specified behavior must change, change the spec/ADR here first (a separate change), then implement it.
10. Track progress in the implementing repository, not here (see *Task tracking (legacy)*).

## Guardrails

Do not:

- persist bid prices in plain text;
- emit bid prices, individual payment amounts, or the clearing price in events or logs;
- change the commitment format without a new ADR;
- change public-input ordering without a new ADR;
- change the proving system without a new ADR;
- make market configuration mutable after `OPEN`;
- reintroduce a per-market operator key/config — the operator is fixed platform infrastructure (ADR-021);
- reintroduce a single uniform clearing price paid by every winner — this protocol is pay-as-bid;
- loop over every accepted bid inside a single atomic settlement call — settlement is per-bid (ADR-020);
- let the operator choose the canonical root, the clearing price, or the resulting allocation;
- derive trusted proof inputs from arbitrary caller-supplied values when they can be reconstructed from contract state;
- bypass `require_auth()` on debits or ownership-changing operations;
- add a state transition without updating `docs/ARCHITECTURE.md`;
- guess external contract interfaces, including the Confidential Token's;
- refund through `revoke_spender`, or forward `SpenderTransfer` payloads to the token without first verifying the settlement-binding proof (ADR-023);
- change the Poseidon2 sponge or the domain table without a new ADR (ADR-025);
- claim a blocked requirement is complete using mocks.

## Security invariants

1. Bid prices never appear on-chain in clear text, at any point, for any market outcome.
2. Asset (quota token) stays in escrow from `OPEN` until every accepted bid is settled or `FAILED` (its units then return to the seller, ADR-024 D13), unsold units return at `FINALIZED`, or the market is `CANCELLED`.
3. Every accepted bid is fully collateralized for `price × requested_quantity`.
4. Nullifiers cannot be reused while the market can still accept bids.
5. Configuration is immutable after `OPEN`.
6. Allocation (which bids won, and how much) is verified against the canonical accepted-bid set — never trusted on the operator's word.
7. Each accepted bid's settlement (payment and/or refund) is atomic per bid; one bid's outcome never depends on or blocks another's.
8. Every locked fund has a deterministic exit path, whether full refund, partial refund, or payment.
9. The operator cannot move escrowed funds except exactly as the verified allocation and the settlement-binding proof dictate (ADR-023), and cannot choose or rewrite the canonical bid set, the allocation, or the settled amounts.
10. Settlement and refunds are automated and permissionless — no bidder or seller is required to manually claim anything in the ordinary case, and the underlying entry point still works if the keeper automation fails. Payloads are built by the operator (`sk_op`, ADR-023); if the operator itself is offline, bidders exit via `revoke_spender` (post-MVP, OQ-15).

## Preferred implementation style

- Small functions.
- Typed errors.
- Fail-fast validation.
- No hidden state mutation in queries.
- One responsibility per module.
- Explicit state transitions.
- Contract-derived state over caller-declared state.
- Deterministic serialization.
- Tests for every security-sensitive negative path, including partial-fill and undersubscription cases.

## Commands

Recommended baseline:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

Circuit toolchain: `nargo` (Noir) and `bb` (Barretenberg/UltraHonk) — pinned and validated: `nargo 1.0.0-beta.9` + `bb 0.87.0`, with `--scheme ultra_honk --oracle_hash keccak` (the flag combination required for Soroban-verifier compatibility; a newer `nargo` was confirmed incompatible with this `bb` version). See `POC/scripts/env.sh` for the exported pins and `POC/results/toolchain-setup.log` for the install path. Operator/frontend commands belong in the nearest README or plan file once the actual toolchain exists.

## Definition of Done

A task is done only when:

- implementation is complete;
- all dependencies are satisfied;
- no blocker is being hidden by a mock;
- positive tests pass;
- negative tests pass;
- relevant security invariants are preserved;
- docs/specs/ADRs are updated if behavior changed;
- formatting and lint checks pass;
- progress is recorded in the implementing repository (not in this repository's legacy `TASKS.md`).
