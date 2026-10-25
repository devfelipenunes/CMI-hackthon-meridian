# ARCHITECTURE — CMI Auctions

## Components

### Market Factory

Deployed once, platform-wide (ADR-022). Responsibilities:

- allocate the next platform-wide `market_id`;
- deploy a fresh Auction Contract instance per market, from an already-uploaded WASM hash (cheap: a new contract address, not a new bytecode upload);
- maintain the `market_id -> Auction Contract address` registry for discovery/indexing.

Must not:

- deploy more than one active Auction Contract instance for the same market;
- let an Auction Contract instance outlive its one assigned market by serving a second one.

### Auction Contract

One instance per market, for that market's entire lifecycle (ADR-022) — never shared across markets. Responsibilities:

- market lifecycle, with duration ≤ 30 days and a 2-day finalization grace (ADR-024 D7);
- holding the seller's XLM fee reserve, which funds the platform's submissions; the remainder is refunded (ADR-024 D15);
- registering **itself** as a Confidential Token account from its constructor, so it can be the collateral spender (ADR-023);
- participant registration and participant IDs;
- fractional asset (quota) escrow (a SAC asset without clawback, 1 quota = 1 whole unit; ADR-024 D18);
- collateral accounting, via the Confidential Token's allowance primitive (ADR-018), including the `live_until_ledger` check the token does not do itself (OQ-11);
- accepted-bid registry, including each bid's public `requested_quantity` (at most 8 bids, ADR-024 D17);
- nullifier registry;
- canonical commitment root, recomputed at close with the standard Poseidon2 sponge (ADR-005, ADR-025);
- clearing-price allocation verification (ADR-019);
- per-bid settlement, one transaction per bid, amounts bound by a settlement proof, including the confidential 10% house fee to the platform's fee wallet (ADR-020, ADR-023, ADR-026);
- `release_unsettled` for winning bids that can no longer settle, plus the return of unsold units (ADR-024 D13);
- timeout cancellation.

Must not:

- store bid prices in clear text;
- let the operator define the canonical root or the clearing price/allocation — both must be verified against the real accepted-bid set;
- let the operator choose settlement amounts — they are bound by the settlement-binding proof (ADR-023);
- allow config mutation after `OPEN`;
- depend on an off-chain database for canonical auction state.

### Eligibility Policy

Interface:

```rust
fn is_eligible(
    participant: Address,
    market_id: u64
) -> bool;
```

Ships disabled by default for the MVP — see ADR-011. Possible implementations when enabled:

- Zolvency adapter;
- SEP-57-compatible adapter;
- Merkle allowlist fallback.

### Verifier Adapter

MVP target (ADR-017), all UltraHonk / Noir, verified via Soroban's native BN254 host functions (CAP-0074):

- `bid_validity` (RF-12);
- `winner_allocation` (RF-18);
- `settlement_binding` (ADR-023, RF-20), on its own verifier instance with a VK fixed at deploy time.

The Confidential Token verifies its own circuits (`register`, `set_spender`, `spender_transfer`, `revoke_spender`, …) through its own verifier contract.

### Confidential Token Integration

Stellar's own Confidential Token (Pedersen commitments over Grumpkin, proved in Noir/UltraHonk) is used directly, not reimplemented. It wraps native XLM (ADR-024 D10). CMI deploys its own token, verifier and auditor set, whose auditor key belongs to the operator (ADR-024 D3/D14). Validated live in `POC/poc-5-live-confidential-token` and `POC/poc-6-atomic-settlement`:

- **the Auction Contract is a registered confidential account**, via `register` called from its constructor, with the spending key `sk_op` held by the operator (ADR-023);
- **confidential collateral:** the bidder calls `set_spender` (with the bidder's own proof), naming the Auction Contract as spender, for `price × requested_quantity`;
- **confidential payment:** `confidential_transfer_from(auction → seller)` for exactly `price × filled_quantity − fee`;
- **house fee:** `confidential_transfer_from(auction → platform fee wallet)` for exactly `floor(price × filled × 10%)`, taken from the seller's proceeds (ADR-026);
- **confidential refund:** `confidential_transfer_from(auction → bidder)` for exactly `price × (requested − filled)`. It is **not** `revoke_spender`, which needs the bidder's own proof and signature (ADR-023). `revoke_spender` remains the bidder's own exit.

All three legs carry a `SpenderTransfer` proof built by the operator with `sk_op`, and are preceded in the same call by the settlement-binding proof that fixes their amounts.

### Operator

The operator role is the platform's own automated backend — never the seller, never a bidder. See ADR-021.

**Keys it holds in the MVP** (backend database, separate keys; HSM/TEE is post-MVP; ADR-024 D5/D14/D19):
- the envelope decryption key (ADR-004);
- the spender key `sk_op` of every Auction Contract (ADR-023), also used as the token auditor key (D3);
- a dedicated admin wallet for CMI's token, verifier and auditor deployment;
- a dedicated **fee wallet**, a confidential account that only receives the house fee (D22).

The seller and the fee wallet must both be registered Confidential Token accounts: every settlement sends each of them a leg, and the token rejects a leg to an unregistered account. The Factory checks both at `create_market` (RF-01, ADR-024 update).

The operator:

- can read locked collateral amounts, and therefore bid prices, from lock time, as spender and as auditor. This is accepted for the MVP (ADR-024 D2/D6). It is also technically able to decrypt envelopes before close (OQ-12);
- computes the clearing price and resulting allocation (ADR-019);
- generates the `winner_allocation` proof and submits it on-chain;
- builds each bid's settlement payloads (three `SpenderTransfer` proofs — seller, fee, refund — and the settlement-binding proof). Its keeper submits them, funded by the seller's fee reserve;
- is assumed always online in the MVP (ADR-024 D12, OQ-15).

The operator cannot:

- move escrowed funds except exactly as the verified allocation and the settlement-binding proof dictate;
- alter accepted-bid state;
- choose the canonical root;
- finalize with an invalid allocation proof.

## Identifiers

### `market_id`

Platform-wide monotonically increasing `u64`, allocated by the Market Factory and passed into each Auction Contract instance as immutable construction config (ADR-022). No longer contract-scoped — since each instance only ever hosts one market, "contract-scoped" and "platform-wide" now coincide for any single instance, but the counter itself lives in the Factory, not in the instance.

### `participant_id`

Each registered wallet receives a market-scoped monotonically increasing `u32`. The contract stores:

```text
participant_id -> Address
Address -> participant_id
```

The bid commitment binds `participant_id`, not raw `Address`, avoiding ambiguous address-to-field encoding inside circuits.

### `bid_index`

Each accepted bid receives a zero-based `u32` in acceptance order. `bid_index` defines:

- canonical leaf position;
- FCFS rationing order at the clearing-price margin (ADR-019);
- winner-to-address lookup.

### `requested_quantity`

Public `u32` per accepted bid — how many quotas that bid asked for. Tracked as contract state alongside `bid_index`, not inside the commitment or the canonical leaf (see ADR-005's update note).

## Canonical bid set

For accepted bid `i`:

```text
leaf_i = Poseidon(
    BID_LEAF_DOMAIN,
    bid_index,
    commitment
)
```

Leaves are ordered by `bid_index` and padded up to `MAX_BIDS = 8` with `EMPTY_LEAF`. The root is one standard Poseidon2 hash over the padded list, recomputed by the contract at close (ADR-025; the future evolution to incremental absorption or a Merkle tree is documented there). The operator does not provide this root.

## State machine

```text
CREATED
   │ deposit asset + lock config
   ▼
OPEN
   │ close_ledger reached
   ▼
CLOSED
   │ valid allocation proof
   ▼
FINALIZED            (unsold units, total_quotas − Σ filled, return to the seller here)
   │ per bid: settle (ADR-020/ADR-023) → bid SETTLED
   │      or release_unsettled, when token.is_spender(bidder, auction) == false
   │         (revoked or expired): the bid's filled units return to the seller → bid FAILED
   ▼
SETTLED              (every bid is SETTLED or FAILED)

CREATED ─────────────────────► CANCELLED

OPEN ── only if zero accepted bids ─► CANCELLED

CLOSED ── finalize_by_ledger reached without finalization ─► CANCELLED
```

Undersubscription (total requested quantity below total supply, but at least one accepted bid) is **not** a cancellation trigger — it resolves inside the normal `FINALIZED`/`SETTLED` path as the degenerate case of ADR-019's allocation rule (every bid fills in full; unsold quotas return to the seller at `FINALIZED`, ADR-024 D13).

## Liveness

At market creation:

```text
close_ledger                  ≤ creation + 30 days   (ADR-024 D7)
finalization_grace_ledgers    = 2 days
```

At close:

```text
finalize_by_ledger = close_ledger + finalization_grace_ledgers
```

If the operator does not finalize by `finalize_by_ledger`, anyone may cancel the market.
- **Asset:** cancellation returns it to the seller.
- **Collateral:** every locked position is refunded through the same per-bid settlement entry point, with `filled_quantity = 0`. The payloads are built by the operator.
- **Operator gone:** if the operator itself is gone, each bidder exits with their own `revoke_spender`. This is the post-MVP case (OQ-15), and it still satisfies G8.
- **Bid whose delegation is gone:** a bidder who revoked (or whose lock expired) before the refund ran is closed with `release_unsettled`, which moves no quota here (`filled = 0`) and marks the bid `FAILED` (ADR-024 D13, update).
- **End:** once no bid is left open, the remaining seller fee reserve returns to the seller. The market stays `CANCELLED`, which is terminal: no transition to `SETTLED`.

## Allocation flow

```text
CLOSED
  ↓
canonical root frozen (public requested_quantity per bid also frozen)
  ↓
operator obtains valid openings for every accepted bid
  ↓
compute clearing price: order by price desc, accumulate quantity until supply exhausted
  ↓
determine filled_quantity per bid (full above the margin, zero below, FCFS-rationed at the margin)
  ↓
generate winner_allocation proof
  ↓
contract verifies proof
  ↓
allocation (bid_index -> filled_quantity) stored
  ↓
FINALIZED
```

## Settlement flow

```text
FINALIZED
  ↓
for each accepted bid_index (automated, one permissionless call per bid, one transaction — ADR-020/ADR-023):
  ├─ settlement-binding proof verified (seller = gross − fee, fee = 10% of gross, refund = price × unfilled; gross = price × filled)
  ├─ confidential payment: gross − fee        → seller,           via confidential_transfer_from
  ├─ house fee:            fee (10% of gross) → platform fee wallet, via confidential_transfer_from
  ├─ confidential refund:  price × unfilled   → bidder,           via confidential_transfer_from(to = bidder)
  └─ quota asset: filled_quantity units → bidder
  ↓
SETTLED once every accepted bid is SETTLED or FAILED
```

**Who builds and who submits.** Every leg carries a `SpenderTransfer` proof built with the operator's `sk_op`. Settlement is therefore permissionless to submit, but the operator has to build it (ADR-023; the operator-offline case is post-MVP, OQ-15).

**Cost.** One bid's full settlement (three legs plus quota) uses 348.8M of the 400M CPU instructions allowed per transaction (87%, POC-6, ADR-026). No further proof verification fits in `settle`. One full settlement uses about **60% of a ledger's CPU budget** (348.8M of `ledger_max_instructions = 580M` on testnet), so **at most one such settlement fits per ledger**. The keeper therefore submits bids one per ledger: a market with 8 winners needs at least ~8 ledgers (~40 s) to settle, more if other heavy transactions compete for the same ledger.

**A bid that can no longer settle.** When the bidder revoked or the lock expired (the contract checks `token.is_spender`), the bid is closed with the permissionless `release_unsettled(bid_index)`: its filled units return to the seller and the bid is marked `FAILED` (ADR-024 D4/D13).

**Unsold units** return to the seller at `FINALIZED`.

**Privacy.** No individual payment amount, and no aggregate clearing price, is ever introduced into public contract state. The `Settled` event carries only the bidder and the public `filled_quantity`.
