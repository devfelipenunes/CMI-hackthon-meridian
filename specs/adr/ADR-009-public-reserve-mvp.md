# ADR-009 — Public reserve price in MVP

## Decision
Reserve price is public market configuration in the first implementation.

## Reason
Private reserve adds proof and state complexity but is not required to demonstrate the core property: no public bid reveal and confidential settlement.

## Consequences
- `reserve_price` can be a public input to `bid_validity`;
- `winner_proof` does not need reserve because every canonical bid was already validated.

## Roadmap
Committed/private reserve.

## Update — minimum price per quota
Under the multi-unit model (ADR-019), "reserve price" is the seller-set **minimum price per quota** — still public market configuration, still a public input to `bid_validity`, unchanged in kind from the decision above; only the per-unit framing is new.
