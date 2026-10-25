# ADR-012 — No public bid reveal phase

## Decision
The protocol has no lifecycle phase whose normal operation publishes bid values.

## Product Property
Bid values remain private to the public after close, winner proving, and settlement.

## Clarification
This ADR says nothing about operator blindness. Operator visibility is governed by ADR-003 and OQ-01.

## Update — who learns what after settlement
- **The public:** still never learns any bid value.
- **The operator:** as spender and token auditor, it learns every price from lock time (ADR-024 D2/D3).
- **The seller:** it decrypts each incoming payment in order to use it, and `filled_quantity` is public, so it can derive each **winner's** price after settlement. Losers' prices stay hidden from the seller. Accepted in ADR-024 D20 (OQ-22).
