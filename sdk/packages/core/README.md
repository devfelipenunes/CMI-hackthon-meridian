# @zolvency-cmi/core

The core of the CMI Auctions SDK, used by `client` (browser and Node) and by `operator` (Node):

- **Protocol cryptography:** Poseidon2, Grumpkin, commitment, nullifier, bid root, ECDH envelope
  for the operator, clearing-price allocation, and settlement values — each formula implemented
  once, with parity proven against the contracts' vectors.
- **UltraHonk proofs** with `@noir-lang/noir_js 1.0.0-beta.9` and `@aztec/bb.js 0.87.0` (keccak
  transcript), in Node and the browser: `createProver`.
- **Confidential Token** (OpenZeppelin): keys, `register`, `set_spender`, `spender_transfer`,
  `revoke_spender`, balance and received-transfer reads.
- **Stellar/Soroban:** `ChainClient` (simulate, signing through a `Signer`, events, typed errors as
  `CmiError` with stable codes) and the Factory, Auction, and token ports.
- **Per-market version** (`marketVersion`): the SDK only proves for an `auction.wasm` it knows.

Secrets (price, blindings, keys) travel as `Secret<T>` and never go into a log, error, or JSON.

In the browser, `@stellar/stellar-sdk` needs `Buffer` (the `buffer` package), and bb.js/noir stay
out of Vite's pre-bundle (`optimizeDeps.exclude`). This package embeds the token demo SDK
(`@ctd/sdk`, MIT); see `THIRD_PARTY_NOTICES.md`.
