# ADR-025 — Standard Poseidon2 sponge, frozen domain table, canonical root recomputed at close

## Context
1. **Non-standard sponge in the POCs.**
   - Every POC circuit hashed with a hand-built Poseidon2 sponge, because `std::hash::poseidon2::Poseidon2::hash` is `pub(crate)` in Noir 1.0.0-beta.9.
   - The port in POC-2/POC-4 (copied into POC-6) had a deviation. Once the 3-element rate was full, it permuted and then **overwrote** `state[0]` with the next input instead of **adding** it.
   - The result is a valid but non-standard hash for inputs longer than 3 elements (bid commitment: 6; envelope masks: 4; root: 8). It differs from the Confidential Token's `lib.nr::sponge` and from any off-the-shelf Poseidon2 implementation.
2. **OQ-04.** The canonical root could be maintained incrementally or recomputed at close.

## Decision

### 1. One Poseidon2 sponge everywhere
- **The sponge.** Every protocol hash (bid commitment, nullifier, envelope masks, canonical leaf, canonical root) uses the **Confidential Token's standard sponge**, `lib.nr::sponge`: width 4, rate 3, capacity 1, IV `len · 2^64` in `state[3]`. Inputs are **added** into the rate lanes, with one permutation per full block plus one for any remainder, and the output is `state[0]`.
- **Parity is proven.** Each circuit that hashes carries a `poseidon2_matches_confidential_token_sponge` test with vectors from the demo SDK's byte-for-byte port (`POC/poc-2`, `poc-4`, `poc-6`).
- **On-chain parity.** On-chain hashing (the root at close, RF-16) must use the same sponge built on Soroban's native Poseidon2 permutation. The token already does this for `address_to_field` (3 inputs). Parity for 6- and 9-input hashes must be covered by RF-16's tests.

### 2. Frozen domain table
All values are disjoint from the Confidential Token's own tags (1–15).

| Constant | Value | Use |
|---|---|---|
| `BID_COMMIT_DOMAIN` | 1001 | `Poseidon2(1001, price, market_id, participant_id, blinding, nullifier_seed)` |
| `BID_ENVELOPE_MASK_DOMAIN` | 1002 | `Poseidon2(1002, S.x, S.y, lane)` |
| `BID_LEAF_DOMAIN` | 1003 | `leaf_i = Poseidon2(1003, bid_index, commitment_i)` |
| `NULLIFIER_DOMAIN` | 1004 | `Poseidon2(1004, nullifier_seed, market_id, participant_id)` |
| `EMPTY_LEAF` | 999999 | padding leaf value up to `MAX_BIDS` |

### 3. Canonical root recomputed at close (MVP)
- The contract stores the accepted commitments by `bid_index` (at most `MAX_BIDS = 8`).
- `close_market` computes the leaves and `root = Poseidon2(leaf_0 … leaf_7)` once, over the padded list.
- `winner_allocation` receives `root` as a public input and recomputes it from its witnesses. This is the ADR-005 formula, measured in POC-4 at 4,796 gates.

## Future evolution
Recorded so a later change is a deliberate step, not a surprise.

1. **Incremental absorption (no circuit change).** The contract can absorb each leaf into the sponge state as bids arrive and finish with the padding at close. The root value is identical, so only contract code changes.
2. **Merkle tree** — when `MAX_BIDS` grows well beyond 8, or when a circuit needs per-bid membership proofs against the root.
   - The root *format* changes, so `winner_allocation` and its VK change.
   - Requires a new ADR (guardrail: public inputs / commitment format).
   - Applies only to markets created afterwards. Each market is its own immutable contract (ADR-022), so live markets keep the version they were created with.
3. **Raising `MAX_BIDS`.** Recompile and re-measure per ADR-013. Proving cost is paid at the ceiling by every market (POC-4 finding).

## Consequences
- The bid commitment, envelope masks and root in POC-2/POC-4/POC-6 were re-derived with the standard sponge and re-validated:
  - locally and with negative cases;
  - on-chain for POC-2 and POC-4;
  - live end to end for POC-6.
- **POC-4's commitment is a simplified two-field form** (`Poseidon2(1001, price, blinding)`). The production `winner_allocation` (RF-18) must use the full commitment above.
