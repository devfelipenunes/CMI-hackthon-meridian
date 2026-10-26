# @zolvency-cmi/client

O SDK do usuário do CMI Auctions — bidder e seller —, no navegador e no Node.

```ts
import { connectClient, BrowserKeyProvider, BrowserOpeningStore } from "@zolvency-cmi/client";

const cmi = connectClient({
  chain, contracts, signer /* a carteira */, prover,
  keys: new BrowserKeyProvider({ network }),          // a chave confidencial (IndexedDB, cifrada)
  openings: new BrowserOpeningStore({ network }),     // as aberturas do saldo, que sobrevivem a um reload (S-22)
});
await cmi.account.ensureRegistered();                 // conta confidencial; peça o backup: cmi.account.exportBackup(senha)
await cmi.account.sync();                             // ao abrir o app: reabre o saldo pelos eventos do token, se preciso
await cmi.account.deposit(amount);                    // público: escolha um valor que não revele o preço
const bid = await cmi.bidder.prepareBid(marketId, price, quantity);   // provas no navegador; nada travado ainda
await cmi.bidder.placeBid(bid);                       // set_spender + submit_bid (D-14)
await cmi.bidder.status(marketId);                    // filled e reembolso, depois do settlement
await cmi.markets.get(marketId);                      // visão pública, sem preço
```

- **Seller:** `createMarket`, `openMarket`, `cancelMarket`, `proceeds`.
- **Recebimentos:** `account.sync()` (ou `account.receive(fromLedger)`) decifra o reembolso e os
  pagamentos do settlement; `merge` os torna gastáveis.
- **Outro navegador:** `account.importBackup(texto, senha)` restaura a chave e as aberturas;
  `account.sync()` completa com os eventos novos (janela do RPC, ~7 dias).
- O preço nunca sai do navegador em claro; erros são `CmiError` com `code` estável e, depois do
  lock, `recovery: "revoke_spender"`.
- Este pacote **não** contém o código do operador.
