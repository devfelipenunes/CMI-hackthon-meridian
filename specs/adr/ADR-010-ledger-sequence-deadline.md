# ADR-010 — Ledger-sequence deadlines

## Decision

Use:

```text
close_ledger
finalization_grace_ledgers
finalize_by_ledger = close_ledger + finalization_grace_ledgers
```

for auction timing.

## Reason

The protocol needs deterministic ledger-relative close and escape-path semantics.

## Consequences

- close is permissionless after `close_ledger`;
- cancellation is permissionless after `finalize_by_ledger` if still `CLOSED`.
