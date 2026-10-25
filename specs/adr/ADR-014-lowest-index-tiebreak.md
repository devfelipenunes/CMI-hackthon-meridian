# ADR-014 — Lowest accepted bid index wins ties

## Decision

Auction rule:

1. highest bid value wins;
2. if values are equal, the lower `bid_index` wins.

## Reason

This is deterministic and cheaper to prove than lexicographic commitment comparison.

## Consequence

Submission order matters only for exact-value ties.
