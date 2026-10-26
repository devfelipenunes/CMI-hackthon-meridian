# Example `operator-node`

The operator backend, in Node, running the SDK keeper (`@zolvency-cmi/operator`) over a network's
markets: `close`, `finalize` with the `winner_allocation` proof, `settle` of each bid with the three
legs and the `settlement_binding` proof, and `release_unsettled` when the delegation disappears.

Before acting on a market, it checks the contracts version through the Auction WASM hash (S-18): a
market from a version the SDK does not know is skipped with `UnsupportedContractsVersion`.

```bash
./scripts/localnet.sh up && ./scripts/deploy-local.sh
CMI_OPERATOR_SPENDER_KEY=… CMI_OPERATOR_ENVELOPE_KEY=… CMI_OPERATOR_SUBMITTER=S… \
  pnpm --filter @zolvency-cmi/example-operator-node start -- <Auction address>
```

- `DEPLOYMENT`: the deploy JSON (default: `deployments/local.json`).
- `CMI_CONTRACTS_RELEASE`: the artifacts tag installed by `scripts/fetch-artifacts.sh` (default: the
  submodules' development artifacts).

Keys through environment variables are for the example only. In the real backend, they come from an
`OperatorKeyStore` over the database or an HSM (S-11), and the process, scheduling, and market list
belong to the backend (S-12). The example's test is
`packages/operator/test/integration/operator-node.test.ts`.
