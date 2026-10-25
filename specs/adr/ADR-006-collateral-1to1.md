# ADR-006 — Exact full collateralization in MVP

## Decision

For every accepted bid:

```text
locked_collateral_value == bid_value
```

No leverage and no excess winner collateral.

## Reason

This removes:

- settlement credit risk;
- winner-surplus accounting;
- a second private amount from settlement logic.

## Consequences

Losers receive the full locked amount back.
The winner's full locked amount is the settlement amount.

## Blocker

The exact proof linkage to the Confidential Token collateral representation is unresolved in OQ-02.
