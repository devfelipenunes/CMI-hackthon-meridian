# Example `bidder-web`

The bidder in the browser, with Vite: the confidential account (`BrowserKeyProvider`, key in
IndexedDB), the deposit, the two proofs (`bid_validity` and `set_spender`) in the browser itself,
the collateral lock, and `submit_bid`. The price never leaves the browser in clear text.

```bash
./scripts/localnet.sh up && ./scripts/deploy-local.sh
pnpm --filter @zolvency-cmi/example-bidder-web build
pnpm --filter @zolvency-cmi/example-bidder-web preview
# http://localhost:4173/?rpc=http://localhost:8000/soroban/rpc&passphrase=…&factory=C…&token=C…&auditor=C…&secret=S…&market=1
```

What an app needs to use the SDK in the browser (the `vite.config.ts` and `src/` here do it):

- **`Buffer`:** `@stellar/stellar-sdk` (and, through it, the SDK) uses Node's `Buffer`. Install the
  `buffer` package's version before any other import (`src/polyfills.ts`).
- **bb.js and Noir out of the pre-bundle** (`optimizeDeps.exclude`), because of the worker and WASM
  (S-14).
- **The artifacts** served by the app with a `SHA256SUMS`, and checked on load (`src/artifacts.ts`,
  S-06).
- **COOP/COEP** only speed up proving (threads); they are not required.
- **The wallet signs.** Here, only for the example and the test, the account signs with a secret key
  from the URL. In a real app, the `Signer` is the user's wallet (e.g. Freighter): the Stellar key
  never passes through the app.
- **Proof in a Web Worker and a pre-warmed backend** (S-14's recommendation), so the screen does not
  freeze during the ~5–10 s of each proof. The example proves on the main thread to stay short.

Tests: `pnpm test:examples` (the bundle contains no `operator` code and fits the
`bundle-budget.ts` budget) and, with the local network up,
`examples/bidder-web/test/integration/place-bid.test.ts` (the whole bid in Chromium).
