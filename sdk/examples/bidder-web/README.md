# Exemplo `bidder-web`

O bidder no navegador, com Vite: a conta confidencial (`BrowserKeyProvider`, chave no IndexedDB),
o depósito, as duas provas (`bid_validity` e `set_spender`) no próprio navegador, o lock do
colateral e o `submit_bid`. O preço nunca sai do navegador em claro.

```bash
./scripts/localnet.sh up && ./scripts/deploy-local.sh
pnpm --filter @zolvency-cmi/example-bidder-web build
pnpm --filter @zolvency-cmi/example-bidder-web preview
# http://localhost:4173/?rpc=http://localhost:8000/soroban/rpc&passphrase=…&factory=C…&token=C…&auditor=C…&secret=S…&market=1
```

O que um app precisa para usar o SDK no navegador (o `vite.config.ts` e o `src/` daqui fazem isso):

- **`Buffer`:** o `@stellar/stellar-sdk` (e, por ele, o SDK) usa o `Buffer` do Node. Instale o do
  pacote `buffer` antes de qualquer outro import (`src/polyfills.ts`).
- **bb.js e Noir fora do pre-bundle** (`optimizeDeps.exclude`), por causa do worker e do WASM (S-14).
- **Os artefatos** servidos pelo app com um `SHA256SUMS`, e conferidos na carga (`src/artifacts.ts`, S-06).
- **COOP/COEP** só aceleram a prova (threads); não são obrigatórios.
- **A carteira assina.** Aqui, só para o exemplo e o teste, a conta assina com uma chave secreta da
  URL. Num app real, o `Signer` é a carteira do usuário (ex.: Freighter): a chave Stellar nunca
  passa pelo app.
- **Prova num Web Worker e backend pré-aquecido** (recomendação da S-14), para a tela não travar
  nos ~5–10 s de cada prova. O exemplo prova na thread principal, para ficar curto.

Testes: `pnpm test:examples` (o bundle não contém código do `operator` e cabe no orçamento de
`bundle-budget.ts`) e, com a rede local no ar, `examples/bidder-web/test/integration/place-bid.test.ts`
(o lance inteiro no Chromium).
