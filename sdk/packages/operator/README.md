# @zolvency-cmi/operator

O SDK do operador do CMI Auctions, **só para Node** (back-end). Ele nunca entra no navegador.

```ts
import { CmiOperator, Keeper, InMemoryOperatorKeyStore } from "@zolvency-cmi/operator";

const operator = new CmiOperator({ keys /* OperatorKeyStore: banco ou HSM */, factory, tokenAddress, prover, auction, token });
const keeper = new Keeper(operator, { clock: { ledger: () => chain.latestLedger() }, onEvent });
await keeper.run(markets /* AsyncIterable dos mercados */, signal);
```

- `registerDataForNextMarket` (o `register_data` que o seller passa ao criar o mercado);
- `readBids` (decifra e confere cada lance: raiz, abertura, colateral);
- `planAllocation` + `proveAllocation` (regra do preço de corte e prova `winner_allocation`);
- `buildSettlement` (as 3 pernas encadeadas e a prova `settlement_binding`);
- `Keeper`: `close`, `finalize`, `cancel_expired`, `settle` (um por ledger, com retry e
  quarentena) e `release_unsettled`, sem estado próprio — reiniciado, relê a chain.

As chaves vêm de um `OperatorKeyStore` que o back-end implementa (S-11). Veja o exemplo
`examples/operator-node` do repositório.
