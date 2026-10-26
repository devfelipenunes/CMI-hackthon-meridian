# Arquitetura do front-end

Como o front é montado sobre o SDK, onde cada coisa mora e como cada pessoa usa o app. As telas estão em [SCREENS.md](SCREENS.md).

---

## 1. Onde o front fica no sistema

```text
┌────────────────────────── navegador ──────────────────────────┐
│  web (Vite + React, SPA estática)                    │
│   telas · estado de UI · carteira · persistência local         │
│        │                                                       │
│        ▼                                                       │
│  @zolvency-cmi/client  (bidder · seller · account · markets)   │
│  @zolvency-cmi/core    (ChainClient · Prover bb.js · portas)   │
│  @zolvency-cmi/artifacts (circuitos + VKs conferidos)          │
│        │  assina com a carteira (Freighter / carteira dev)     │
└────────┼───────────────────────────────────────────────────────┘
         ▼
 ───────────── Stellar RPC (testnet) ─────────────────────────
  Factory · Auction (1 por mercado) · Confidential Token · Verifiers · SACs
         ▲
┌────────┼──────────── sistema do operador (outro projeto, F-04) ─┐
│  @zolvency-cmi/operator (Node) · chaves sk_op e do envelope      │
│  keeper: close → finalize (winner_allocation) → settle ×N        │
│  entrega ao front só o register_data (público, F-03)             │
└──────────────────────────────────────────────────────────────────┘
```

**Rede:** a testnet, com o deploy `v0.1.0-rc.4` já feito (F-06).

**O que o front não tem:** banco, API, fila ou servidor. O que precisaria de back-end foi resolvido assim:

| Necessidade | Solução sem back-end | Base |
|---|---|---|
| `register_data` do operador para `create_market` | **Constante pública por token** (D-02 dos contratos: a prova amarra o endereço do token, não o do mercado). Vem do sistema do operador e fica no arquivo de configuração da rede (F-03) | `CmiOperator.registerDataForNextMarket` |
| Lista de mercados | `MarketsApi.list()` lê a Factory (ids `1..next−1`) | `client/src/markets` |
| Fechar e cancelar por timeout | `close_market` e `cancel_expired` são **permissionless**: qualquer usuário pode chamar (e recebe 0,5 XLM da reserva) | CONTRACTS.md §3 |
| `finalize` e `settle` | Sistema do operador, separado (F-04). O front só mostra o progresso pelos eventos | `operator/src/{allocation,settlement}.ts` |
| Chave confidencial do usuário | `BrowserKeyProvider` do SDK (IndexedDB, AES-GCM, backup por senha) | S-10 do SDK |
| Aberturas do saldo | `BrowserOpeningStore` + `account.sync()`, **novos no SDK** (SDK-A/B, F-08) | S-20 do SDK, `requests/001` |

---

## 2. Stack (F-01)

| Peça | Escolha | Por quê |
|---|---|---|
| Build | Vite 7.3.6 | a mesma do `examples/bidder-web`, já medida com o SDK (S-14) |
| UI | React 18 + TypeScript estrito | ecossistema de carteiras e testes |
| Rotas | React Router | SPA, deploy estático |
| Dados da rede | TanStack Query | cache, revalidação por ledger, estados de carregamento |
| Estilo | Tailwind CSS + componentes próprios | sem dependência de CDN (CSP, S-10) |
| Formulários | React Hook Form + Zod | validação local antes de chamar o SDK |
| Carteira | Stellar Wallets Kit (Freighter) + carteira dev (F-05) | `walletSigner` do SDK aceita o formato |
| Testes | Vitest + Testing Library + Playwright | o mesmo Vitest do SDK |

---

## 3. Como o SDK entra no app (F-02)

O SDK **não está publicado no npm** (passo 6.5 do SDK preparado, não publicado). O front consome o código-fonte pelo submódulo, num workspace pnpm:

```yaml
# pnpm-workspace.yaml
packages:
  - app
  - scripts
  - sdk/packages/*
  - sdk/third_party/stellar-confidential-token-demo/packages/sdk
```

- Pré-requisito: `git submodule update --init` na raiz e `git -C sdk submodule update --init` (o SDK tem 3 submódulos: `contracts`, `specs` e `third_party/stellar-confidential-token-demo`; o `@ctd/sdk` é compilado no `postinstall`). **Sem `--recursive`** (falha por um gitlink órfão no `specs`) e **por SSH** (repositórios privados). Passo a passo no README da raiz.
- O app depende de `@zolvency-cmi/{artifacts,core,client}` (`workspace:*`). `@zolvency-cmi/operator` e `@zolvency-cmi/testing` só nos `scripts/` e nos testes.
- **Quando o SDK for publicado**, trocar `workspace:*` pela versão do npm muda só o `package.json`.

**Requisitos do SDK no navegador** (copiados do `examples/bidder-web`):
- `Buffer` do pacote `buffer`, instalado antes de qualquer import (`src/polyfills.ts`);
- `optimizeDeps.exclude` para `@aztec/bb.js` e `@noir-lang/*`;
- artefatos (`register`, `set_spender`, `bid_validity`, `revoke_spender`: circuitos e VKs) servidos em `/artifacts/` com `SHA256SUMS`, conferidos na carga (`verifyArtifacts`);
- COOP/COEP opcionais (threads do bb.js). A compatibilidade com a carteira é conferida no passo 0.2.

---

## 4. Camadas do app

Cada camada depende só das de cima.

| # | Camada | Pasta | Conteúdo |
|---|---|---|---|
| 1 | Configuração | `src/config/` | `NetworkConfig` (rpc, passphrase, contratos, `registerData`, segundos por ledger), carregada de `public/config/testnet.json` e validada com Zod |
| 2 | Infra SDK | `src/sdk/` | `ChainClient`, `Prover` único e pré-aquecido, artefatos, `BrowserKeyProvider`, `BrowserOpeningStore` (SDK-A), `connectClient`, `StaticRegisterDataProvider` |
| 3 | Carteira | `src/wallet/` | adaptadores (Freighter via Wallets Kit, carteira dev), `walletSigner`, conferência de rede, operações clássicas (trustline, saldo XLM, friendbot) |
| 4 | Domínio de UI | `src/domain/` | formatação (XLM, cotas), conversão data ↔ ledger, tradução de `CmiError.code` → mensagem + ação, sugestão de depósito (F-12), papéis (F-07) |
| 5 | Hooks | `src/hooks/` | `useMarkets`, `useMarket`, `useMarketEvents`, `useConfidentialAccount`, `useBalances`, `usePrepareBid`, `useMyBid`, `useProceeds`… (TanStack Query sobre o `CmiClient`) |
| 6 | Telas | `src/pages/`, `src/components/` | as telas de [SCREENS.md](SCREENS.md) |

**Fronteiras (dependency-cruiser):**
- `src/**` não importa `@zolvency-cmi/operator` nem `@zolvency-cmi/testing`;
- só `src/sdk/` instancia coisas do SDK; as telas usam hooks;
- `src/pages` não importa `@stellar/stellar-sdk` direto.

---

## 5. Estrutura de pastas

```text
web/
├── README.md
├── package.json                  # raiz do workspace: dev, build, lint, test, e2e, scripts de ambiente
├── pnpm-workspace.yaml
├── tsconfig.base.json            # strict, ES2022 (os mesmos flags do SDK)
├── vitest.config.ts              # projetos: unit, browser, integration
├── playwright.config.ts          # e2e na testnet
├── eslint.config.js
├── .dependency-cruiser.cjs
├── .node-version                 # 22
├── specs/                  # submódulo
├── sdk/                   # submódulo (com os 3 submódulos dele)
├── docs/                         # este planejamento
├── app/
│   ├── index.html
│   ├── vite.config.ts            # polyfills, optimizeDeps, artefatos + SHA256SUMS, COOP/COEP, CSP, relatório de módulos
│   ├── public/config/            # testnet.json (gerado pelo sync-deployment; sem segredo)
│   └── src/
│       ├── main.tsx  polyfills.ts  App.tsx  routes.tsx
│       ├── config/   sdk/   wallet/   domain/   hooks/
│       ├── components/           # UI base: botões, tabelas, stepper, toasts, countdown, ProofProgress
│       └── pages/
│           ├── home/             # lista de leilões
│           ├── market/           # detalhe + linha do tempo
│           ├── onboarding/       # carteira, modo, conta confidencial, backup
│           ├── wallet/           # saldos, depósito, merge
│           ├── company/          # dashboard, criar, abrir, cancelar, recebimentos
│           └── investor/         # lance, meus lances, recuperação
├── scripts/                      # Node (tsx); podem usar @zolvency-cmi/testing, nunca entram no app
│   ├── sync-deployment.ts        # deploy da testnet → app/public/config/testnet.json (F-06)
│   ├── register-data.ts          # grava o register_data do operador no config (F-03)
│   ├── issue-quota-token.ts      # cria o token de cotas na carteira da empresa, na testnet (F-13)
│   └── fund.ts                   # friendbot da testnet
├── .local/                       # fora do git: tokens emitidos, chaves de desenvolvimento
├── e2e/                          # Playwright: o leilão inteiro pelo app, na testnet
└── docs/requests/                # pedidos ao SDK (001: estado da conta confidencial)
```

---

## 6. Fluxos

### 6.1 Primeiro acesso (qualquer modo)

```text
conectar carteira ──► rede da carteira == config? (senão: NetworkMismatch na tela)
   ▼
escolher modo: Empresa | Investidor   (F-07: preferência local, sem efeito on-chain)
   ▼
conta confidencial: client.account.ensureRegistered()
   │  cria o sk (BrowserKeyProvider) + prova register + tx register   [carteira assina]
   ▼
backupRequired? ──► tela de backup OBRIGATÓRIA antes de depositar ou criar leilão
   client.account.exportBackup(senha)   (chave + aberturas do saldo, S-22)
   → download do arquivo → confirmação → keys.markBackedUp(conta, tokenAddrF)
   ▼
toda abertura do app (e antes de depósito, lance ou merge): client.account.sync()
   stored → nada a fazer · checkpoint/events → saldo reaberto pelos eventos do token
   BalanceOutOfSync → explicar a janela de ~7 dias e oferecer importar um backup mais recente
```

**O `connectClient` do app recebe sempre** `keys: new BrowserKeyProvider({ network })` **e** `openings: new BrowserOpeningStore({ network })` (S-10, S-22). Sem o segundo, o SDK usa o `MemoryOpeningStore`, e um F5 quebra o saldo.

A Factory recusa `create_market` se o seller não tem conta no token (`Factory.SellerNotRegistered`), então a empresa também passa por aqui.

### 6.2 Empresa cria e abre o leilão (RF-01, RF-03, RF-04, RF-07)

```text
pré-requisitos (checados na tela):
  conta confidencial registrada · saldo XLM ≥ fee_reserve + taxas · cotas do ativo na carteira
wizard: ativo (SAC) · total de cotas · preço mínimo por cota (XLM) · data de fechamento · reserva (≥ 5 XLM)
  data → close_ledger (ledger atual + segundos ÷ segundos por ledger da rede, F-10)
  resumo: taxa da casa de 10% (FEE_BPS) e o que a empresa recebe por cota vendida
  checkMarketParams(params, ledgerAtual)                       ← mesmos códigos da Factory
client.seller.createMarket(params, StaticRegisterDataProvider)  [carteira assina]
  → { marketId, address }  (a reserva de XLM vai para a Auction)
client.seller.openMarket(marketId)                              [carteira assina]
  → cotas em custódia (escrow) + config_hash → Open
```

`createMarket` e `openMarket` são duas transações. Um mercado `Created` aparece no painel com a ação "Abrir (travar cotas)" e "Cancelar".

### 6.3 Investidor dá o lance (RF-05, RF-09..RF-15) — a ordem é a do SDK

```text
na tela do leilão: pré-aquecer o Prover (carregar bb.js + circuitos)
checagens visíveis: trustline da cota (senão: botão "Habilitar cota" → changeTrust [carteira])
                    conta confidencial · saldo gastável ≥ preço × quantidade (senão: depositar)
formulário: preço por cota (XLM) + quantidade
client.bidder.prepareBid(marketId, price, qty)
   preflight → (register_participant, se preciso [carteira]) → 2 provas no navegador
   nada é travado; BelowMinPrice para antes de qualquer transação
   warnings: DepositRevealsPrice → aviso explícito
tela de confirmação (preço só em memória)
client.bidder.placeBid(prepared)     set_spender [carteira] → submit_bid [carteira]
   ok → { bidIndex }
   erro com recovery "revoke_spender" → botão "Recuperar colateral" (client.bidder.recoverCollateral)
```

### 6.4 Fechamento, resultado e settlement

```text
Open, ledger ≥ close_ledger        → qualquer usuário: "Fechar leilão" (close_market) ou o keeper
Closed                             → sistema do operador: finalize (winner_allocation)   [F-04]
Closed, ledger > finalize_by       → qualquer usuário: "Cancelar por timeout" (cancel_expired)
                                     (na testnet de teste: 120 ledgers ≈ 10 min depois do fechamento)
Finalized / Cancelled              → sistema do operador: settle por lance (1 por ledger)
   sem delegação viva              → qualquer um / operador: release_unsettled
Settled                            → fim
```

Depois do settlement:
- **Investidor:** `client.bidder.status(marketId)` (cotas recebidas e reembolso decifrado) → `client.account.sync()` + `client.account.merge()` para tornar o reembolso gastável.
- **Empresa:** `client.seller.proceeds(marketId)` (o que cada vencedor pagou, já sem os 10%) → `sync` + `merge`.
- **Histórico fora da janela do RPC (S-23):** um lance `Settled` com `refund: null` (status) ou `received: null` (proceeds) quer dizer "liquidado, mas a perna já não está no RPC (~7 dias)". A tela mostra isso, nunca zero. O saldo continua certo, porque o `sync` (ou o backup) o reabre. Isso depende do passo 7.3 do SDK.
- **Saque do saldo confidencial para XLM público:** o SDK **não** oferece `withdraw` no `client` (só o circuito existe nos artefatos). Fora do MVP (2026-10-20); entra com o SDK-C no futuro (F-14).

---

## 7. Segurança no front

| Regra | Como o front cumpre |
|---|---|
| Preço nunca persiste | o preço vive só no estado do formulário e no `PreparedBid` (segredos em `Secret<T>`); nada de preço em URL, `localStorage`, cache do TanStack Query persistido, analytics ou log |
| Erros sem segredo | a UI mostra só `CmiError.code` traduzido (S-15/S-16); nunca o `cause` |
| `sk` do usuário | só o `BrowserKeyProvider`; o front mostra backup, importação e "esquecer neste navegador" |
| Aberturas do saldo | `BrowserOpeningStore` do SDK, cifrado com uma `CryptoKey` não extraível (SDK-A, F-08) |
| Operador fora do bundle | lint de fronteira + teste de bundle (`dist/modules.json` sem `packages/operator` nem `packages/testing`) |
| XSS / extensões | CSP rígida (`script-src 'self' 'wasm-unsafe-eval'`), nenhum script de CDN, dependências fixadas |
| Rede errada | `ChainClient.assertNetwork()` + conferência da rede da carteira antes de assinar |
| Depósito revela o preço | o front sugere valores de depósito que não sejam `price × qty` e mostra o aviso `DepositRevealsPrice` (F-12) |
| Artefato trocado | `verifyArtifacts()` na carga; app não prova se falhar |

**Limitação conhecida (informar na UI e no README):** no build atual, a chave do envelope (`PK_operator`) é uma **constante de teste do circuito** (D-06 dos contratos; os testes do SDK usam `987654321098`). Qualquer um que a conheça decifra os envelopes. Na testnet do MVP isso é aceito; a garantia "só o operador vê os preços" só vale com uma chave de envelope real, o que exige um circuito novo.
