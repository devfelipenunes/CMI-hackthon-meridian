# @zolvency-cmi/operator

The CMI Auctions operator SDK, **Node only** (backend). It never enters the browser.

```ts
import { CmiOperator, Keeper, InMemoryOperatorKeyStore } from "@zolvency-cmi/operator";

const operator = new CmiOperator({ keys /* OperatorKeyStore: database or HSM */, factory, tokenAddress, prover, auction, token });
const keeper = new Keeper(operator, { clock: { ledger: () => chain.latestLedger() }, onEvent });
await keeper.run(markets /* AsyncIterable of markets */, signal);
```

- `registerDataForNextMarket` (the `register_data` the seller passes when creating the market);
- `readBids` (decrypts and checks each bid: root, opening, collateral);
- `planAllocation` + `proveAllocation` (clearing-price rule and the `winner_allocation` proof);
- `buildSettlement` (the three chained legs and the `settlement_binding` proof);
- `Keeper`: `close`, `finalize`, `cancel_expired`, `settle` (one per ledger, with retry and
  quarantine), and `release_unsettled`, with no state of its own — restarted, it re-reads the chain.

Keys come from an `OperatorKeyStore` the backend implements (S-11). See the repository's
`examples/operator-node`.
