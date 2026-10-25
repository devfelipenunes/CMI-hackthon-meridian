# ADR-013 — MAX_BIDS starts at 8

## Decision

Start with fixed:

```text
MAX_BIDS = 8
```

until winner-proof benchmarks justify increasing it.

## Requirements

- `submit_bid` rejects the ninth accepted bid;
- canonical tree always has exactly `MAX_BIDS` leaf positions;
- unused positions use `EMPTY_LEAF`.

## Upgrade condition

Increase only after measured proving and on-chain verification costs remain within targets.

## Update — benchmark target changed
The benchmark this limit depends on is no longer a single-winner argmax circuit — it is the multi-unit clearing-threshold allocation circuit (ADR-019), proved in UltraHonk/Noir (ADR-017). Re-measure against that circuit specifically before revisiting this number; do not carry over any cost estimate made against the old argmax/Groth16 design.

## Update — upgrade condition measured and satisfied at MAX_BIDS=8

`POC/poc-4-clearing-price-allocation` implements the actual `winner_allocation` formalization (ADR-019's clearing-price rule + FCFS margin rationing, formalized per OQ-09) and was compiled, proved, and verified on-chain at `MAX_BIDS=8` specifically — not extrapolated from a smaller test size.

| `MAX_BIDS` | ACIR opcodes | Gates | Local proving time | On-chain CPU instructions |
|---|---|---|---|---|
| 3 (earlier test scenario) | 138 | 3,539 | well under 1s | 91,000,700 |
| **8 (this ADR's production value)** | **366** | **4,796** | **~0.3s combined** | **92,156,131** |

Both proving time and on-chain verification cost are trivially small at `MAX_BIDS=8` — on-chain cost sits in the same flat band as every other circuit measured for this project (OQ-03), and local proving is a fraction of a second. **This satisfies the upgrade condition above as a floor, not a ceiling being tested**: there is no measured cost pressure at 8 today.

A separate finding relevant to any *future* reconsideration of this number: a market with fewer real bids than `MAX_BIDS` does not pay a smaller proving cost. Confirmed empirically with a `MAX_BIDS=32`, `bid_count=2` build: 1,454 ACIR opcodes / 10,704 gates — identical to a fully-packed 32-bid market, because ACIR is generated once at compile time from `MAX_BIDS` alone and is witness-independent (`bid_count` only selects which loop iterations are "active" at runtime; the compiled circuit always executes every iteration). **Every market pays the proving cost of the configured `MAX_BIDS` ceiling, regardless of how many bids it actually receives** — a reason to size `MAX_BIDS` to the real worst-case market, not "as large as possible just in case." On-chain verification cost is unaffected either way (the flat-cost finding above holds regardless of `bid_count`); this tradeoff is proving-side only, and proving is borne by the operator once per market finalization, not by individual bidders.

Full detail: `POC/results/SUMMARY.md`'s "MAX_BIDS=8 benchmark" section.

## Update — confirmed as a product limit (, ADR-024 D17)
The product owner confirmed at most 8 bids per market for the MVP. Raising the limit follows this ADR's re-benchmark condition and ADR-025's note on the root.
