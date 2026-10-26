# O SDK que o front usa — mapa rápido

Fonte completa: `sdk/docs/API.md` e o código em `sdk/packages/{client,core,artifacts}/src/`. **Se este mapa e o código divergirem, vale o código** (e corrija este arquivo no mesmo commit).

Pacotes do app: `@zolvency-cmi/client`, `@zolvency-cmi/core`, `@zolvency-cmi/artifacts`. Só nos scripts e testes: `@zolvency-cmi/operator`, `@zolvency-cmi/testing`, `@zolvency-cmi/artifacts/node`.

---

## 1. Montar o client (camada `app/src/sdk/`)

```ts
import "./polyfills";   // Buffer do pacote `buffer`, ANTES de qualquer import do SDK (examples/bidder-web/src/polyfills.ts)
import { ChainClient, browserBackendLoader, createProver, walletSigner, keypairSigner, type WalletAdapter } from "@zolvency-cmi/core";
import { BrowserKeyProvider, BrowserOpeningStore, connectClient } from "@zolvency-cmi/client";
import { ArtifactSet, parseSha256Sums, verifyArtifacts } from "@zolvency-cmi/artifacts";

const chain = new ChainClient({ rpcUrl, networkPassphrase });          // testnet: https://soroban-testnet.stellar.org
await chain.assertNetwork();                                            // NetworkMismatch
const prover = createProver({ artifacts, backendLoader: browserBackendLoader(), threads: navigator.hardwareConcurrency });
const client = connectClient({
  chain,
  contracts: { factory, token, auditor },                               // do config/testnet.json
  signer: walletSigner(wallet),                                         // Freighter; carteira dev: keypairSigner(secret)
  keys: new BrowserKeyProvider({ network: networkPassphrase }),
  openings: new BrowserOpeningStore({ network: networkPassphrase }),    // SEMPRE (S-22)
  prover,
});
// ao sair: await prover.destroy()
```

- **Artefatos** (circuitos + VKs do `register`, `set_spender`, `bid_validity`, `revoke_spender`): copiados pelo `vite.config` para `/artifacts/` com um `SHA256SUMS` e carregados com `new ArtifactSet(files, sums, { contractsTag: null })` + `verifyArtifacts(set)`. Molde: `examples/bidder-web/vite.config.ts` e `src/artifacts.ts`.
- **Vite:** `optimizeDeps.exclude: ["@aztec/bb.js", "@noir-lang/noir_js", "@noir-lang/acvm_js", "@noir-lang/noirc_abi"]`, `worker.format: "es"`, `build.target: "es2022"`. COOP/COEP opcionais (threads).
- **`WalletAdapter`** (formato Freighter / Wallets Kit): `{ address, signTransaction(xdr, { networkPassphrase, address }) → { signedTxXdr } }`.
- **Leitura sem carteira** (público): `new MarketsApi({ factory: chainFactoryPort({ chain, address: factory }), auction: (a) => chainAuctionPort({ chain, address: a }) })`.

## 2. `client.account` — conta confidencial (RF-08, S-10, S-20, S-22)

| Chamada | Retorno | Notas |
|---|---|---|
| `ensureRegistered()` | `{ keys, backupRequired }` | cria a chave se preciso, prova `register` + tx [carteira] |
| `sync({ fromLedger? })` | `{ source: "stored" \| "checkpoint" \| "events", events, syncedLedger }` | ao conectar e antes de valor; `BalanceOutOfSync` = janela da RPC perdida → oferecer importar backup |
| `balance()` | `{ spendable, receiving }` (bigint, stroops) | confere contra a chain |
| `deposit(amount)` | `TxResult` | **valor público**; nunca o colateral exato (F-12) [carteira] |
| `merge()` | `TxResult` | "a receber" → gastável [carteira] |
| `exportBackup(password)` | `string` | chave + aberturas; senha ≥ 12 caracteres |
| `importBackup(text, password)` | `{ account, openings: boolean }` | `InvalidBackup`; depois chame `sync()` |
| `receive(fromLedger)` | `{ transfers }` | legado; prefira `sync()` |

Chave (o `BrowserKeyProvider` da sessão): `backupStatus(account, tokenAddrF) → { backupRequired }`, `markBackedUp(account, tokenAddrF)`, `forget(account, tokenAddrF)`. Aberturas: `BrowserOpeningStore.forget(account, tokenAddrF)`. `tokenAddrF = addressToField(tokenAddress)` (`@zolvency-cmi/core`).

## 3. `client.bidder` — o lance (RF-05, RF-09..RF-15; ordem obrigatória)

| Chamada | Retorno | Notas |
|---|---|---|
| `prepareBid(marketId, price, quantity)` | `PreparedBid` | preflight → (`register_participant` [carteira], se preciso) → 2 provas no navegador. **Nada travado.** `price` = stroops por cota |
| `placeBid(prepared)` | `{ bidIndex }` | `set_spender` [carteira] → `submit_bid` [carteira]. Erro depois do lock: `recovery: "revoke_spender"` |
| `recoverCollateral(marketId)` | `TxResult` | prova `revoke_spender` + tx [carteira] |
| `status(marketId)` | `MyBidView { bidIndex, status, requested, filled, refund: bigint \| null }` | `Settled` + `refund: null` = fora da janela da RPC (S-23) |

`PreparedBid`: `{ marketId, auction, participantId, requestedQuantity, submission, publicInputs, setSpender: { liveUntilLedger, data, cA }, warnings: ("DepositRevealsPrice")[], secrets }`. **Nunca serialize nem guarde** um `PreparedBid`.

Erros do preflight (antes de qualquer escrita): `PriceOutOfRange`, `Auction.ZeroQuantity`, `BelowMinPrice`, `MarketNotOpen`, `BiddingClosed`, `MarketFull`, `AlreadyBid`, `NoTrustline` (`recovery: "change_trust"`), `KeyNotFound`, `Token.AccountNotRegistered`, `BalanceOutOfSync`, `InsufficientBalance`, `ProofFailed`. Depois do lock: `Token.DelegationAlreadyExists`, `CollateralMismatch`, `Auction.*`.

## 4. `client.seller` — a empresa (RF-01, RF-03, RF-04, RF-07)

| Chamada | Retorno | Notas |
|---|---|---|
| `checkMarketParams(params, ledger)` | `void` (lança) | mesmos códigos da Factory: `InvalidTotalQuotas`, `InvalidMinPrice`, `InvalidCloseLedger`, `DurationTooLong`, `InvalidFeeReserve` |
| `createMarket(params, provider)` | `{ marketId, address }` | `params: MarketParams { quotaAsset (SAC C…), totalQuotas, minPricePerQuota (stroops), closeLedger, eligibilityPolicy: null, feeReserve (stroops ≥ MIN_FEE_RESERVE) }`; `provider: RegisterDataProvider { forNextMarket() → { marketId, address, registerData } }` [carteira] |
| `openMarket(marketId)` | `TxResult` | só em `Created`; trava `totalQuotas × QUOTA_UNIT` do SAC [carteira] |
| `cancelMarket(marketId)` | `TxResult` | `Created`, ou `Open` sem lances (`Auction.HasBids`) [carteira] |
| `proceeds(marketId)` | `Proceed[] { bidIndex, filled, received: bigint \| null }` | precisa de `token`, `keys`, `tokenAddress` no contexto (o `connectClient` já dá); `null` = fora da janela (S-23) |

`Factory.SellerNotRegistered` → a empresa precisa da conta confidencial; `Factory.FeeWalletNotRegistered` → problema do deploy (avisar).

## 5. Mercados e ações permissionless (RF-16, RF-19, RF-22)

- `client.markets.list({ status? })` → `MarketView[]`; `client.markets.get(marketId)` → `MarketView { marketId, address, seller, status, quotaAsset, totalQuotas, minPricePerQuota, closeLedger, finalizeByLedger, bidCount, demand, allocation }`. **Nenhum preço de lance.**
- `client.markets.watch(marketId, { fromLedger, pollIntervalMs?, signal? })` → `AsyncIterable<AuctionEvent>`; termina no `MarketSettled` ou num cancelamento sem lances.
- `client.auctionAt(address)`: `closeMarket(signer)` (ledger ≥ `closeLedger`), `cancelExpired(signer)` (ledger > `finalizeByLedger`), `getFeeReserve()`, `getBidRecord(i)`, `getSettlementStatus(i)`.
- `chain.latestLedger()`, `chain.oldestEventLedger()`, `chain.eventStart(ledger)` (o início que a RPC aceita, S-23).

## 6. Constantes e erros (`@zolvency-cmi/core`)

`QUOTA_UNIT = 10_000_000n`, `MIN_FEE_RESERVE = 50_000_000n` (5 XLM), `MAX_DURATION_LEDGERS = 518_400` (30 dias), `MAX_BIDS = 8`, `FEE_BPS = 1000n` (10%), `PRICE_MAX_EXCLUSIVE = 2n ** 63n`, `SECONDS_PER_LEDGER = 5`. Erros: `CmiError { code, recovery? }`; as tabelas `AUCTION_ERRORS`, `FACTORY_ERRORS`, `TOKEN_ERRORS` e o tipo `CmiErrorCode` servem para o teste "toda tradução existe" (passo 0.4).

## 7. Só scripts e testes (Node)

- `@zolvency-cmi/operator`: `buildRegisterData({ spenderKey: new Secret(sk), tokenAddress, prover })` → `Uint8Array` (passo 1.2); `CmiOperator`/`Keeper` só nos testes de ponta a ponta (6.1), nunca no app.
- `@zolvency-cmi/artifacts/node`: `loadDevArtifacts()` (prover no Node).
- `@zolvency-cmi/testing`:
  - rede: `setTestNetwork(TESTNET)`, `fundAccount(G…)`, `parseDeployment(json)`;
  - cotas: `issueQuotaAsset({ code, holders: [{ kp, quotas }] })` → `{ asset, sac, issuer }`, `addTrustline(kp, asset)` (passo 1.3);
  - conta no token: `registerLocalAccount`;
  - fakes para os testes de fluxo (TESTING §3.1): `FakeFactory`, `FakeAuction`, `FakeToken` (com `accountEventLog` e `oldestEventLedger`), `FakeQuota`, `FakeProver`, `FakeClock`, `SeededRng`, `CallLog`, `MemoryLogger`;
  - auditoria: `assertNoSecretLeak`.
- Exemplos prontos para copiar o molde: `sdk/examples/bidder-web/` (app no navegador) e `examples/operator-node/` (keeper); integração de referência: `packages/client/test/integration/{bid,sync}.test.ts`.
