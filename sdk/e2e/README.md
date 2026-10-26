# SDK E2E

Proves the end-to-end flow **against a real network**, not against fakes: lock collateral in the
Confidential Token, submit the bid, close, allocate with a proof, settle each bid, and check the
result. It runs in three rounds, in the order the contracts were released.

| Round | What it exercises | Checks |
|---|---|---|
| `rc1` | Collateral lock and bid submission with the real token | `RF-08`, `RF-09`, `RF-11`, `RF-14` |
| `rc2` | Per-bid settlement, fee, refund, and rollback | `RF-20` |
| `rc3` | Full auction: create → bid → close → allocate → settle | the whole flow |

The definitions live in [`src/checks/`](src/checks/); the generated evidence is a JSON with the
checks, the contracts commit, the SDK commit, the WASM hashes, the VKs, and the CPU cost of each
transaction.

## Running it

Prerequisites: the SDK installed, a local network running (`sdk/scripts/localnet.sh up`) or
testnet, and the matching deployment JSON.

```bash
cd sdk

# against the contracts' development artifacts
pnpm e2e --contracts dev --network local --round rc1

# against a published contracts release
pnpm e2e --contracts v0.1.0 --network testnet --round all
```

Flags:

- `--contracts <tag|dev>` — a contracts release, or `dev` for `contracts/wasm` and the WASMs
  compiled into `contracts/target/`.
- `--network local|testnet` — the deployment read and the RPC used.
- `--round rc1|rc2|rc3|all` — the round; the default comes from the tag.

## What it refuses

Before running, the runner compares the SHA-256 of every local WASM with the deployment's
`wasm_sha256`. If a WASM is not the one deployed, the E2E **aborts** instead of testing something
else. The same applies to the network: `local` requires the local network up; `testnet` requires
the testnet deployment.

Output is written to `e2e/evidence/` (not tracked by default). The exit code is `0` when every
check passes, `1` when one fails, and `2` when the runner aborts before starting.
