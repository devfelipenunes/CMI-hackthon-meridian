# ADR-016 — Permissionless finalization timeout cancellation

## Decision

If a market remains `CLOSED` beyond:

```text
finalize_by_ledger
```

without a valid winner proof, anyone may cancel it.

Cancellation:

- returns the auctioned asset to the seller;
- unlocks refunds (per ADR-020's automatic, permissionless entry point) for every participant with locked collateral.

## Reason

No operator should be able to trap funds indefinitely.

## Consequence

Winner proving has a finite liveness window.

## Update — refunds after cancellation (, ADR-023/ADR-024 D12)
Refunds go through the per-bid settlement entry point with `filled_quantity = 0`, and the operator builds their payloads with `sk_op`. If the operator itself is gone, each bidder exits with the token's own `revoke_spender`. That exit is manual but always available, and it is the post-MVP case in OQ-15.

## Update — a bid whose delegation is gone (, ADR-024 D13)
A bidder who revokes before their refund `settle` runs leaves a bid that `settle` cannot close. That bid is closed with `release_unsettled`, which is also available in `CANCELLED`: it becomes `FAILED` and moves no quota. Once no bid is left open, the remaining seller fee reserve returns to the seller. The market stays `CANCELLED`.
