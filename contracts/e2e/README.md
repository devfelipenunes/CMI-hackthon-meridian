# Contracts E2E evidence

Each file is the output of an SDK E2E run against the **real** contracts and the **real**
Confidential Token, on a local network. It is the proof that the critical paths work outside the
unit tests — with real transactions, real proofs, and measured CPU cost.

| File | Round | What it covers |
|---|---|---|
| `v0.1.0-rc.1.json` | `rc1` | Registration in the real token, `set_spender`, accepted and rejected `submit_bid`, revocation, and refund |
| `v0.1.0-rc.2.json` | `rc2` | Partial, full, and zero settlement; fee rejected when wrong; leg rollback; `release_unsettled` |

Each JSON records:

- `contracts_tag` and `contracts_commit` — what was deployed;
- `sdk_commit` — who generated the proofs;
- `wasm_sha256` and `vk_sha256` — the exact bytes used in the run;
- `checks[]` — each verified RF, `PASS`/`FAIL`, transaction hash, and CPU.

To generate a new file, run `cd sdk && pnpm e2e --contracts <tag> --network local`. The runner
refuses to run when the local WASM is not the deployed one (see
[`sdk/e2e/README.md`](../../sdk/e2e/README.md)).
