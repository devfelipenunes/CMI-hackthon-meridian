# PRODUCT ROADMAP — CMI Auctions

> Product roadmap: phases, MVP scope and future evolutions. The step-by-step **implementation** roadmap, and the progress of each RF, lives in the implementing repository.

## Phase 0 — Blocking technical spikes

All must be resolved before the full auction path is considered stable:

1. **Resolved** — UltraHonk/Noir on Soroban, for both `bid_validity` and `winner_allocation`: toolchain validated, real cost anchor established, four circuit-shaped constructions proved and verified on Stellar testnet. See `docs/OPEN_QUESTIONS.md` OQ-03, `POC/results/SUMMARY.md`.
2. **Resolved** — Bid-envelope consistency and availability: ECDH-derived masking construction, implemented and verified on-chain. See OQ-01, `ADR-004`, `POC/poc-2-envelope-consistency`. Availability (OQ-05) is resolved separately: envelopes live in contract storage (ADR-024 D8).
3. **Resolved** — Confidential collateral linkage into `bid_validity`, validated live against the deployed Confidential Token. See OQ-02 and `POC/poc-5-live-confidential-token`.
4. **Resolved** — Multi-unit, pay-as-bid allocation proof over the canonical root (clearing price + FCFS margin rationing): formalized as a no-sort accumulator, validated at production `MAX_BIDS=8`. See OQ-09, `POC/poc-4-clearing-price-allocation`.
5. **Resolved** — Atomic per-bid confidential settlement: spender-driven refund, settlement-binding proof, and one transaction per bid, including the 10% house-fee leg (348.8M of 400M CPU; ADR-026). See OQ-06/OQ-13, `ADR-023`, `POC/poc-6-atomic-settlement`.
6. **Resolved** — Poseidon2 standardized to the Confidential Token's sponge, domain table frozen, canonical root recomputed at close. See `ADR-025`, OQ-04.

## Phase 1 — HackMeridian MVP

Target:

- multi-unit quota sale (a fixed total number of quotas per market);
- pay-as-bid: each winner pays their own bid price for the quotas they receive;
- first-price sealed-bid: prices sealed from the public forever; the operator (also the token auditor in the MVP) can read locked amounts from lock time (ADR-024 D2/D3);
- highest price first, FCFS tie-break at the clearing margin (lowest accepted `bid_index`);
- one bid per participant (price + public requested quantity);
- exact collateralization: `price × requested_quantity`;
- public minimum price per quota;
- undersubscription sells only what was bid — no cancellation trigger from it;
- `MAX_BIDS` starts at 8 — benchmarked against the real UltraHonk allocation circuit and confirmed within cost targets at this value; re-benchmark before increasing further (ADR-013);
- no public reveal of any bid price, ever;
- ZK-verified allocation;
- confidential settlement reusing Stellar's Confidential Token directly;
- automated, permissionless per-bid settlement and refunds (no manual claim in the ordinary case), including a confidential 10% house fee (ADR-026);
- timeout cancellation;
- eligibility policy disabled by default (no mandatory KYC), pluggable if enabled later.

## Phase 2 — Post-hackathon

- configurable house fee per market or tier (the circuit already takes `fee_bps` as an input);
- private reserve;
- stronger operator-liveness model;
- multiple independent operators;
- larger bid sets;
- TypeScript SDK;
- production hardening;
- security review/audit;
- mainnet readiness once the Confidential Token itself leaves developer preview.

## Phase 3 — Institutional privacy

- threshold encryption;
- MPC;
- operator blindness;
- Vickrey (second-price) or uniform-price clearing as an alternative auction format;
- bidding ladders (multiple bids per participant);
- private credit allocation;
- confidential bookbuilding;
- RFQ / OTC;
- mainnet.
