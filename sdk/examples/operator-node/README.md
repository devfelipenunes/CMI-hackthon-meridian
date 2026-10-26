# Exemplo `operator-node`

O back-end do operador, em Node, rodando o keeper do SDK (`@zolvency-cmi/operator`) sobre os
mercados de uma rede: `close`, `finalize` com a prova `winner_allocation`, `settle` de cada bid com
as três pernas e a prova `settlement_binding`, e `release_unsettled` quando a delegação some.

Antes de agir num mercado, ele confere a versão dos contratos pelo hash do WASM da Auction (S-18):
um mercado de uma versão que o SDK não conhece é pulado com `UnsupportedContractsVersion`.

```bash
./scripts/localnet.sh up && ./scripts/deploy-local.sh
CMI_OPERATOR_SPENDER_KEY=… CMI_OPERATOR_ENVELOPE_KEY=… CMI_OPERATOR_SUBMITTER=S… \
  pnpm --filter @zolvency-cmi/example-operator-node start -- <endereço da Auction>
```

- `DEPLOYMENT`: o JSON do deploy (padrão: `deployments/local.json`).
- `CMI_CONTRACTS_RELEASE`: a tag dos artefatos instalados por `scripts/fetch-artifacts.sh`
  (padrão: os artefatos de desenvolvimento dos submódulos).

As chaves por variável de ambiente são só para o exemplo. No back-end real, elas vêm de um
`OperatorKeyStore` sobre o banco ou um HSM (S-11), e o processo, o agendamento e a lista de
mercados são do back-end (S-12). O teste do exemplo é
`packages/operator/test/integration/operator-node.test.ts`.
