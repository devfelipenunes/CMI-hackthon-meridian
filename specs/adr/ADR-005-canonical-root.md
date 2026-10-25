# ADR-005 — Canonical accepted-bid root

## Decision

Each accepted bid receives a monotonically increasing `bid_index`.

Leaf:

```text
leaf_i = Poseidon(BID_LEAF_DOMAIN, bid_index_i, commitment_i)
```

Leaves are ordered by `bid_index` and padded to fixed `MAX_BIDS` with a protocol-defined `EMPTY_LEAF`.

The contract derives/finalizes the root from accepted bids.

## Reason

The operator must not be able to omit, reorder, or inject bids during winner proving.

## Consequences

- winner proof operates over a deterministic set;
- `bid_index` can also be the tie-break;
- padding semantics become part of the proof protocol.

## Update — quantity is not in the leaf
Under the multi-unit model (ADR-019), each accepted bid also carries a public `requested_quantity`. It is tracked as public per-`bid_index` contract state alongside the leaf, not hashed into `leaf_i` itself — the leaf/commitment layout defined above is unchanged.

## Update — root computation (, ADR-025)
The root is one standard Poseidon2 hash over the padded leaf list (`MAX_BIDS = 8`), recomputed by the contract at close. The documented future evolution is incremental absorption (same root) or a Merkle tree (new root format, new ADR); see ADR-025.
