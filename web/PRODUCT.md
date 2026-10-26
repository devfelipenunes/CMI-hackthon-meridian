# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing codebase: Vite 7 + React 18 + TypeScript strict, TanStack Query, React Hook Form + Zod, Tailwind, Stellar Wallets Kit, consuming the CMI SDK from the repository workspace. Testnet only.

## Users

**Companies (sellers).** Small and mid-sized issuers holding a real-world asset (receivables, carbon, inventory, fund quotas) who want price discovery without publishing a reserve or tipping their hand to competitors. They work from a laptop, usually while doing three other things, and need to know exactly what will be locked, when, and what they will receive.

**Investors (bidders).** Professional or semi-professional buyers who understand auctions and expect the mechanics to be legible: what is sealed, what is public, what happens if the auction is cancelled, how a refund returns. They judge the product in the first ninety seconds.

**Platform operator.** A separate system, not a user of this app. It closes and settles auctions; the app only shows its progress and offers the permissionless actions anyone can take when it is late.

## Product Purpose

CMI Auctions runs multi-unit, sealed-bid, pay-as-bid auctions of tokenized RWA quotas on Stellar. The front end lets a company create and open an auction and lets investors bid, without a backend: the wallet signs, the SDK proves in the browser, and the chain holds the state. Success means a complete auction can run from creation to settlement through this app, with no price ever leaving the bidder's device in readable form.

## Positioning

The bid is confidential, the demand is public, and the settlement is verifiable. No custodian, no order book, no price feed: a bidder proves validity locally and locks collateral in one flow; the seller sees aggregated demand, not competing prices. This is the mechanism the interface must make trustworthy, not decorate.

## Operating Context

- Stellar **testnet**. Real money does not exist here; the app must always say so.
- Ledgers close every ~5 seconds. Dates are estimates derived from ledgers; the ledger number is the source of truth.
- The RPC keeps roughly seven days of events. Anything older is reported as "outside the RPC window", never as zero.
- A market's finalization grace comes from its own config (120 ledgers on the current deployment, about ten minutes), not from a global constant.
- Freighter is the wallet. A development wallet is available only when the build flag enables it.
- The confidential key and balance openings live in this browser (IndexedDB, encrypted). Losing the browser without a backup means losing the key.
- The operator is external. When it misses the deadline, any wallet can cancel and return funds.

## Capabilities and Constraints

- Create, open, cancel a market; prepare and place one bid per wallet per market (maximum 8 bids); recover locked collateral; sync and merge confidential balance; export and import an encrypted backup.
- No withdraw to public XLM in this MVP. The wallet screen says so instead of hiding it.
- Bid price exists only in form state and in the in-memory `PreparedBid`. It must not enter URLs, storage, query keys, logs, or the DOM after submission.
- Two browser proofs per bid; this is slow (seconds, not milliseconds) and the interface must set that expectation before the wallet opens.
- All amounts are `bigint` stroops; quotas are whole numbers.
- Public reads work without a wallet. Wallet-dependent routes explain what is missing instead of redirecting silently.
- The deployment's envelope key is still a test constant. Confidentiality of the envelope is a testnet limitation and must be stated where it matters.

## Brand Commitments

CMI Auctions, under Zolvency. Existing visual tokens from decision F-17: Plus Jakarta Sans, JetBrains Mono for technical values, violet `#635bff` as primary, teal `#00d4b2` as accent, 1rem radius, light and dark themes. The tone is precise and calm; the product deals with money and should not sound like a game.

## Evidence on Hand

- Live testnet deployment: Factory, Confidential Token, Auditor and SAC addresses in `sdk/contracts/deployments/testnet.json`.
- Working SDK flows (`account`, `bidder`, `seller`, `markets`) with 665 tests in the SDK repository.
- No customers, testimonials, benchmarks, pricing claims, or press. None may be invented.

## Product Principles

1. **The mechanism is the message.** Explain what is sealed and what is public at the moment it matters, not in a marketing section.
2. **Never lie about state.** Unknown, stale, outside the RPC window, and cancelled are distinct states. None of them render as zero or as success.
3. **Slow operations announce themselves.** Proof generation and wallet signatures are visible, staged, and cancellable in the mind of the user.
4. **The irreversibility budget is small.** Locking collateral and creating a market are the two moments that deserve friction; everything else should be direct.
5. **Testnet is not a demo.** The interface is production-shaped, but it says plainly where the guarantees stop.

## Accessibility & Inclusion

Keyboard-complete flows, visible focus, no color-only status, contrast at WCAG AA, reduced-motion respected, forms with persistent labels and inline errors. pt-BR only in this phase.
