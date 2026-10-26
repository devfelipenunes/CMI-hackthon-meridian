# @zolvency-cmi/testing

Test utilities for CMI Auctions: the doubles and scenarios shared by the SDK, operator, and
frontend tests, so every layer exercises **the same auction** instead of inventing its own fixture.

This package is **private** and never enters the app's production bundle.

## What it provides

| Export | Purpose |
|---|---|
| `AURORA` | The canonical auction scenario (1,000 quotas, 500 XLM floor, four bids) with the expected allocation and settlement values |
| `SeededRng`, `FakeClock`, `MemoryLogger` | Deterministic RNG, controllable clock, inspectable logger |
| `FakeAuction`, `FakeFactory`, `FakeToken`, `FakeQuota`, `FakeProver` | In-memory ports with `CallLog`, for testing call order and state transitions |
| `FAKE_PLATFORM`, `MARKET_TRANSITIONS`, `fakeBidRecord` | Constants and builders for the fake market |
| `assertNoSecretLeak` | Asserts a secret (price, blinding, key) does not appear in a log, error, or JSON |
| `LOCALNET`, `TESTNET`, `setTestNetwork`, `localChain`, `fundAccount` | Local network and testnet, friendbot, and chain client |
| `loadLocalDeployment`, `parseDeployment`, `PINNED_WASM_SHA256`, `TOKEN_VK_CIRCUITS` | Local deployment and the hashes/VKs the test checks |
| `issueQuotaAsset`, `addTrustline` | Quota token and trustline for scenarios |

## Usage

```ts
import { AURORA, FakeClock, SeededRng, assertNoSecretLeak } from "@zolvency-cmi/testing";

const clock = new FakeClock(100);
const rng = new SeededRng(42);
assertNoSecretLeak(AURORA.bids[0]!.price, [logs, error, payload]);
```

`AURORA` is deep-frozen (`Object.freeze` recursively): a test cannot mutate the scenario and leak
it into another.

## Rule

A double replaces the **external boundary** (network, token, prover), not the property under test.
When the test is about the execution plan, an index, or server behavior, use the real local network
(`LOCALNET`) — not the fake.
