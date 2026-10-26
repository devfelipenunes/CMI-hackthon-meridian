# @zolvency-cmi/client

The CMI Auctions user SDK — bidder and seller — in the browser and in Node.

```ts
import { connectClient, BrowserKeyProvider, BrowserOpeningStore } from "@zolvency-cmi/client";

const cmi = connectClient({
  chain, contracts, signer /* the wallet */, prover,
  keys: new BrowserKeyProvider({ network }),          // the confidential key (IndexedDB, encrypted)
  openings: new BrowserOpeningStore({ network }),     // balance openings that survive a reload (S-22)
});
await cmi.account.ensureRegistered();                 // confidential account; ask for the backup: cmi.account.exportBackup(password)
await cmi.account.sync();                             // on app open: reopen the balance from token events if needed
await cmi.account.deposit(amount);                    // public: choose an amount that does not reveal the price
const bid = await cmi.bidder.prepareBid(marketId, price, quantity);   // proofs in the browser; nothing locked yet
await cmi.bidder.placeBid(bid);                       // set_spender + submit_bid (D-14)
await cmi.bidder.status(marketId);                    // filled and refund, after settlement
await cmi.markets.get(marketId);                      // public view, no price
```

- **Seller:** `createMarket`, `openMarket`, `cancelMarket`, `proceeds`.
- **Proceeds:** `account.sync()` (or `account.receive(fromLedger)`) decrypts the refund and the
  settlement payments; `merge` makes them spendable.
- **Another browser:** `account.importBackup(text, password)` restores the key and openings;
  `account.sync()` fills in new events (the RPC window is ~7 days).
- The price never leaves the browser in clear text; errors are `CmiError` with a stable `code` and,
  after the lock, `recovery: "revoke_spender"`.
- This package does **not** contain the operator code.
