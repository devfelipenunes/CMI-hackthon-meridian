# ADR-007 — Pull-based collateral refunds

## Decision
Each entitled participant withdraws their own collateral.

## Reason
Avoid:
- O(N) settlement/refund loops;
- one recipient blocking all others;
- settlement resource growth with participant count.

## Consequences
- refund is O(1) per caller;
- participants must initiate their own withdrawal;
- entitlement state must prevent double withdrawal.
