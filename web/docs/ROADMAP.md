# Roadmap — front-end, numa fase só

O front é construído **de uma vez** (F-15): uma branch `fase/2-app`, criada a partir da `main`, e um PR final para `main`. Mesmo assim, o trabalho é dividido em passos pequenos. Cada passo:

- começa pelos **testes listados**, escritos antes do código (TDD, [TESTING.md](TESTING.md)), num commit `test(...)` vermelho;
- termina com um commit `feat(...)`/`fix(...)` verde, `pnpm lint` e `pnpm test` verdes;
- é marcado aqui (☐ → ☑) no próprio commit verde.

**Status.** Este arquivo é a **única fonte de status** do front. Legenda:

- ☑ feito e verificado no nível que o passo pede;
- ◐ implementado e coberto por testes unitários, mas falta a verificação de navegador/testnet do passo;
- ☐ não começou.

---

## Pré-requisitos

**Ambiente:** o passo a passo de setup está no [README da raiz](../README.md). As armadilhas conhecidas (submódulos privados por SSH, o `--recursive` que falha) estão lá.

- [x] Decisões F-01..F-18 tomadas (2026-10-20).
- [x] **SDK-A e SDK-B** (passos 7.1 e 7.2 do SDK) na `main` do SDK (`a72c9a4`, PR #10). O submódulo aponta para ela.
- [x] **Passo 7.3 do SDK** (janela de eventos do RPC, S-23) na `main` do SDK (`0693e1f`, PR #11). O submódulo aponta para ela.
- [x] `pnpm install && pnpm test` verdes **dentro do `sdk`** (665 testes com a fase 7).
- [x] **F-03:** `sk_op` de desenvolvimento, trocável pelo `.env.local` (2026-10-20).
- [x] **SDK-C** (saque) fora do MVP (2026-10-20).
- [x] Passo 0.0 (skill, `CLAUDE.md`/`AGENTS.md`, README de setup, `.gitignore`, `.env.example`) feito na preparação (branch `preparacao/dev`).

---

## Passos no SDK (F-14), no fluxo do SDK

Feitos no repositório `sdk`, com a skill `cmi-sdk-tdd` de lá. O SDK não tem branch `development` no remoto: cada fase é uma branch `fase/<n>-<nome>` a partir da `main`, com um PR para a `main` (o push e o merge são do dono do projeto). Depois do merge, o ponteiro do submódulo é atualizado aqui. Detalhe em [requests/001-sdk-account-state.md](requests/001-sdk-account-state.md).

| Passo | Entrega | Bloqueia | Status |
|---|---|---|---|
| SDK-A | `BrowserOpeningStore` (IndexedDB cifrado, escopo rede/token/conta), passo 7.1 do SDK | 2.4 | ☑ na `main` do SDK |
| SDK-B | `account.sync({ fromLedger })` por eventos do token + backup que leva o estado, passo 7.2 do SDK | 2.4 | ☑ na `main` do SDK (validado na testnet; a integração local não rodou, sem Docker) |
| 7.3 do SDK | Janela de eventos do RPC: `ChainClient.eventStart`, `proceeds` com `received: null` fora da janela (S-23) | 3.2, 4.4, 5.4 | ☑ na `main` do SDK (`0693e1f`) |
| SDK-C | `account.withdraw(amount)` | — | **fora do MVP** (2026-10-20) |

---

## Visão geral

| Bloco | Passo | Entrega | RFs | Depende de | Status |
|---|---|---|---|---|---|
| **0 · Fundação** | 0.0 | Preparação: skill `cmi-front-tdd`, `CLAUDE.md`/`AGENTS.md`, README de setup, `.gitignore`, `.env.example` | — | — | ☑ |
| | 0.1 | Workspace pnpm com o SDK, TS, Vitest, lint, fronteiras, CI | — | pré-requisitos | ☑ |
| | 0.2 | App Vite: polyfills, artefatos com `SHA256SUMS`, COOP/COEP, CSP, teste de bundle | RF-12 (base) | 0.1 | ◐ |
| | 0.3 | Configuração de rede (Zod) e infra do SDK (`src/sdk/`) | — | 0.2, 1.1 | ◐ |
| | 0.4 | Domínio de UI: valores, data ↔ ledger, tradução de erros | — | 0.1 | ☑ |
| | 0.5 | Casca do app: layout, rotas, componentes base, textos | — | 0.2 | ◐ |
| **1 · Ambiente (testnet)** | 1.1 | `sync-deployment.ts`: deploy da testnet → `config/testnet.json` | — | 0.1 | ☑ |
| | 1.2 | `register_data` no config (F-03) | RF-01 | 1.1, decisão F-03 | ☑ |
| | 1.3 | `issue-quota-token.ts` + `fund.ts` na testnet (F-13) | — | 1.1 | ☑ |
| **2 · Carteira e conta** | 2.1 | Carteiras: Freighter (Wallets Kit) + carteira dev | — | 0.3 | ◐ |
| | 2.2 | Sessão: `CmiClient` por carteira, modo Empresa/Investidor, Prover único | — | 2.1 | ◐ |
| | 2.3 | Conta confidencial: registro, backup, importar, esquecer | RF-08 | 2.2 | ◐ |
| | 2.4 | Saldo persistente e sincronizado (SDK-A/B) + `BalanceOutOfSync` | RF-08 | 2.3, SDK-A, SDK-B | ◐ |
| | 2.5 | Tela da carteira: saldos, depósito com guarda, sync + merge, atualizar backup | RF-08 | 2.4 | ◐ |
| **3 · Leilões (público)** | 3.1 | Lista de leilões | RF-22 | 0.5, 0.3 | ◐ |
| | 3.2 | Detalhe + linha do tempo + progresso do operador + ações permissionless | RF-03, RF-16, RF-19, RF-22 | 3.1, 2.2, 7.3 do SDK | ◐ |
| **4 · Empresa** | 4.1 | Painel da empresa e pré-requisitos | RF-01 | 2.5, 3.1 | ◐ |
| | 4.2 | Wizard de criação (`createMarket`) | RF-01, RF-02, RF-04 | 4.1, 1.2 | ◐ |
| | 4.3 | Abrir (trava das cotas) e cancelar | RF-03, RF-07 | 4.2 | ◐ |
| | 4.4 | Recebimentos (`proceeds`) | RF-20, RF-22 | 4.3, 7.3 do SDK | ◐ |
| **5 · Investidor** | 5.1 | Checklist do lance: trustline, conta, saldo | RF-05, RF-14 | 2.5, 3.2 | ◐ |
| | 5.2 | `prepareBid` com progresso das provas | RF-10..RF-15 | 5.1 | ◐ |
| | 5.3 | Confirmação + `placeBid` + recuperação | RF-09, RF-11 | 5.2 | ◐ |
| | 5.4 | Meus lances: status, reembolso, merge | RF-20, RF-22 | 5.3, 7.3 do SDK | ◐ |
| **6 · Ponta a ponta** | 6.1 | Leilão completo na testnet com o operador externo | RF-16..RF-21 | 4.4, 5.4, operador | ☐ |
| **7 · Qualidade** | 7.1 | Auditoria de segredos de todos os fluxos | — | 5.3 | ☑ |
| | 7.2 | E2E Playwright na testnet | todos | 6.1 | ◐ |
| | 7.3 | Build de produção e README | — | 7.2 | ◐ |

### Dependências

```text
0.1 ─► 0.2 ─► 0.3 ─► 2.1 ─► 2.2 ─► 2.3 ─► 2.4 ─► 2.5 ─┬► 4.1 ─► 4.2 ─► 4.3 ─► 4.4 ─┐
  │     │      ▲                        ▲              │                            ├► 6.1 ─► 7.2 ─► 7.3
  │     │      │                    SDK-A, SDK-B       └► 5.1 ─► 5.2 ─► 5.3 ─► 5.4 ─┘
  ├► 1.1┴──────┘ ─► 1.2 (F-03) ──────────────────────────► 4.2         └► 7.1
  │      └► 1.3
  ├► 0.4
  └──── 0.5 ─► 3.1 ─► 3.2 ─► 5.1
```

O bloco 3 (público) e os passos 1.x andam em paralelo com o bloco 2. Os passos 3.2, 4.4 e 5.4 dependem do 7.3 do SDK, que já está na `main` do SDK.

**Estado em 2026-10-20.** Blocos 0–5 implementados; `pnpm verify` verde (lint + 82 testes + build + bundle) e `pnpm e2e` verde na parte pública, em Chrome. O fluxo do lance tem teste de tela com os fakes do SDK (`app/test/flows/`): abaixo do piso, ordem `prepareBid` → confirmação → `set_spender` → `submit_bid`, erro pós-trava com recuperação e auditoria de segredos. No jsdom, `app/test/flows/setup.ts` restaura os intrínsecos do Node porque o bundle do stellar-base captura `Uint8Array`/`Buffer` de outro realm (o `@noble/*` recusa esses bytes). Verificados ao vivo na testnet: deploy, `register_data` (prova + simulação de `create_market`), emissão do token de cotas (pausa/retomada de trustline), carteiras dev financiadas, lista e detalhe de mercado reais, **registro da conta confidencial no navegador com a prova real do `register` (25 s no primeiro uso, incluindo o CRS; zero erros de console)**. A CSP precisou liberar `data:` (wasm do bb.js) e `https://crs.aztec.network` (CRS do UltraHonk) — ver F-19. A casa lia os mercados em série pelo `MarketsApi.list` e levava ~40 s com treze mercados; agora usa `markets.get` em paralelo limitado (12) e pinta a lista em ~7 s a frio, com erro visível se um mercado falhar. Pendente para fechar 6.1/7.x: o leilão inteiro pelo app com o operador externo e a Freighter, a prova de `set_spender`/lance e o backup exportado/importado entre contextos.

---

## 0 · Fundação

### 0.0 — Preparação para o desenvolvimento · ☑

Feito antes do código, para quem vai desenvolver (branch `preparacao/dev`):
- `.claude/skills/cmi-front-tdd/` — o fluxo TDD, as fontes da verdade, os guardrails e o mapa de reuso do SDK (`references/sdk-api.md`), no molde da `cmi-sdk-tdd` do SDK;
- `CLAUDE.md` e `AGENTS.md` na raiz (apontam para a skill e para `docs/`);
- `README.md` da raiz com o setup completo (ferramentas, submódulos por SSH, testnet, Freighter, `.env.local`);
- `.gitignore` (inclui `.env.local` e `.local/`) e `.env.example`.

### 0.1 — Workspace pnpm com o SDK

**Objetivo:** um esqueleto que compila, testa e passa no lint, consumindo o SDK do submódulo.
**Decisões:** F-01, F-02.
**Arquivos:** raiz (`package.json` com `packageManager: pnpm@10.34.6`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `eslint.config.js`, `.dependency-cruiser.cjs`, `.node-version` = 22), `app/package.json`, `scripts/package.json`, `scripts/check-toolchain.sh`, `.github/workflows/check.yml`. O `.gitignore` já existe (0.0); complete se precisar.

**Workspace:** `app`, `scripts`, `sdk/packages/*` e `sdk/third_party/stellar-confidential-token-demo/packages/sdk`. O `postinstall` da raiz compila o `@ctd/sdk`, como no SDK: `pnpm --filter @ctd/sdk run build`. Copie do SDK as versões fixadas (`typescript 5.9.3`, `vitest 3.2.7`, `eslint 9.39.5`, `typescript-eslint 8.71.0`, `dependency-cruiser 17.4.3`, `playwright 1.55.1`, `@stellar/stellar-sdk 14.6.1`) e a config de `pnpm.onlyBuiltDependencies`.

**CI** (`.github/workflows/check.yml`, em todo PR): `pnpm install`, `pnpm lint` e `pnpm test`, com Node 22 e pnpm pelo corepack. **Os submódulos são privados:** o checkout precisa de uma credencial com leitura de `sdk`, `contracts` e `specs` (`actions/checkout` com `submodules: true` e `token: ${{ secrets.SUBMODULES_TOKEN }}`, um fine-grained PAT só-leitura cadastrado pelo dono do projeto). Não use `submodules: recursive`: o `specs` tem um gitlink sem URL (ver o README). Inicialize os submódulos do SDK num passo explícito: `git -C sdk submodule update --init`.

**Testes primeiro:**
- [ ] `app imports @zolvency-cmi/client VERSION` (o pipeline enxerga o SDK do workspace);
- [ ] `dependency rules reject app → @zolvency-cmi/operator` e `app → @zolvency-cmi/testing` (fixtures que violam);
- [ ] `check-toolchain.sh fails without submodules initialized`.

**Pronto quando:** `pnpm install && pnpm lint && pnpm test` verdes num clone limpo com submódulos, e a CI verde no PR.

### 0.2 — App Vite e requisitos do SDK no navegador

**Objetivo:** o app carrega o SDK no navegador como o `examples/bidder-web`.
**Decisões:** F-09, S-06, S-14.
**Arquivos:** `app/vite.config.ts`, `app/src/polyfills.ts`, `app/src/sdk/artifacts.ts`, `app/test/bundle/*`.

**Testes primeiro:**
- [ ] `build emits artifacts/ with SHA256SUMS for register, set_spender, bid_validity, revoke_spender`;
- [ ] `artifact VKs match the testnet deployment` (`token_vks` e `vk_sha256` do deploy);
- [ ] `loadBrowserArtifacts rejects a tampered file` (`ArtifactMismatch`);
- [ ] `bundle contains no operator nor testing module` (`dist/modules.json`);
- [ ] `bundle within budget` (ponto de partida: o orçamento do SDK, 1,75 MB JS inicial / 16 MB total, mais a margem do React);
- [ ] browser: `prover warms up and proves set_spender in Chromium`, com e sem `crossOriginIsolated`;
- [ ] browser: `Freighter/Wallets Kit loads under COEP` (decide se COOP/COEP ficam ligados).

**Pronto quando:** `pnpm build` gera o app com artefatos conferidos, e a decisão sobre COOP/COEP está registrada na F-09.

### 0.3 — Configuração de rede e infra do SDK

**Arquivos:** `app/src/config/*`, `app/src/sdk/{chain,prover,client,register-data}.ts`.

**Testes primeiro:**
- [ ] `config schema rejects missing contract or registerData`;
- [ ] `readonlyClient builds MarketsApi without a signer` (o público lê sem carteira);
- [ ] `StaticRegisterDataProvider returns next id, predicted address and the configured bytes`;
- [ ] `prover is a singleton per session and destroyed on dispose`;
- [ ] `assertNetwork mismatch surfaces NetworkMismatch`.

### 0.4 — Domínio de UI

**Arquivos:** `app/src/domain/{amount,time,errors,roles,deposit}.ts`.

**Testes primeiro (tabelas):**
- [ ] `parseXlm/formatXlm` com 7 casas, sem `Number`, valores > 2^53, entradas inválidas;
- [ ] `dateToCloseLedger` e `ledgerToDate` (5 s por ledger e a medição da rede, arredondamento para cima, borda dos 30 dias);
- [ ] `errorMessage(code)` cobre **todo** código do SDK (`AUCTION_ERRORS`, `FACTORY_ERRORS`, `TOKEN_ERRORS` e os locais) e devolve a ação de `recovery`;
- [ ] `suggestDeposit(needed)` nunca devolve exatamente `needed` (F-12).

### 0.5 — Casca do app

**Arquivos:** `App.tsx`, `routes.tsx`, `components/*`, textos inline em inglês (F-16).

**Testes primeiro:**
- [ ] `routes render without wallet` (público);
- [ ] `TxToast shows signing → sent → confirmed/failed`;
- [ ] `ProofProgress shows stages and elapsed time`.

---

## 1 · Ambiente (testnet)

### 1.1 — `sync-deployment.ts` (F-06)

Lê `deployments/testnet.json` da `main` dos contratos (`git show origin/main:…` no submódulo, sem mudar o checkout) ou de um caminho dado, confere na rede e grava `app/public/config/testnet.json`.
**Testes:** [ ] `writes a config that passes the app schema`; [ ] `fails when the factory does not answer or the auction wasm hash differs from the SDK bindings`; [ ] `fails when token VKs differ from dev-sources.json`.

### 1.2 — `register_data` no config (F-03)

`pnpm register-data` (`scripts/register-data.ts`), como na F-03: `CMI_REGISTER_DATA` → `CMI_OPERATOR_SPENDER_KEY` → gera um `sk_op` de desenvolvimento no `.env.local`. Grava `registerData` e `operatorKeyId` em `app/public/config/testnet.json`.
**Testes:**
- [ ] tabela de precedência das três fontes;
- [ ] `generated dev key is written to .env.local once and reused`;
- [ ] `register_data is accepted by create_market on testnet` (simulação, sem enviar);
- [ ] `the secret key is never printed after generation, nor written inside app/`;
- [ ] lint: `app/ cannot read CMI_OPERATOR_* env`;
- [ ] `market created with another operator key is flagged in the market view` (teste do passo 3.2).

### 1.3 — `issue-quota-token.ts` e `fund.ts` na testnet (F-13)

**Testes:** [ ] `issues QUOTA without clawback and pays N to the holder`; [ ] `pauses for the holder's trustline and resumes`; [ ] `prints the SAC address usable as quota_asset`; [ ] `fund creates the account via the testnet friendbot`.

---

## 2 · Carteira e conta

### 2.1 — Carteiras (F-05)

**Testes primeiro:**
- [ ] `walletKit adapter signs through walletSigner with the testnet passphrase`;
- [ ] `dev wallet only with VITE_DEV_WALLET=1`;
- [ ] `wallet on another network blocks signing with a clear message`;
- [ ] `user rejection maps to a typed UI error, not TxFailed`.

### 2.2 — Sessão e modo (F-07)

**Testes primeiro:**
- [ ] `client is rebuilt when the wallet account changes` (e a chave confidencial correspondente);
- [ ] `mode persists per address and switches from header`;
- [ ] `company routes ask for Company mode`.

### 2.3 — Conta confidencial

**Testes primeiro (fakes):**
- [ ] `ensureRegistered then forces backup screen when backupRequired`;
- [ ] `deposit and market creation blocked until markBackedUp`;
- [ ] `import backup with wrong password shows InvalidBackup and writes nothing`;
- [ ] `forget requires double confirmation`;
- [ ] browser: `backup exported in one context imports in another` (IndexedDB real).

### 2.4 — Saldo persistente e sincronizado (F-08)

Usa o `BrowserOpeningStore` (SDK-A) no `connectClient` e chama `account.sync()` (SDK-B) ao conectar e antes de operações de valor. O backup da tela 2.3 passa a ser `client.account.exportBackup(senha)` / `importBackup(texto, senha)`, que levam a chave e as aberturas.
**Testes primeiro:**
- [ ] browser: `balance survives a reload` (o app passa o store persistente ao `connectClient`);
- [ ] `sync runs on connect and before deposit/bid`;
- [ ] `BalanceOutOfSync after sync explains the 7-day window and offers backup import`;
- [ ] integração na testnet: `fresh browser + imported backup recovers the balance by sync`.

### 2.5 — Tela da carteira

**Testes primeiro:**
- [ ] `shows public XLM and confidential spendable/receiving`;
- [ ] `deposit then merge updates spendable`;
- [ ] `deposit screen never asks for a bid price` e `suggest button avoids exact amounts`;
- [ ] `sync + merge after settlement moves refund to spendable`;
- [ ] `update backup exports key and current openings`;
- [ ] `withdraw disabled with explanation` (saque fora do MVP).

---

## 3 · Leilões (público)

### 3.1 — Lista

**Testes primeiro (fakes):**
- [ ] `lists markets with status, demand, bid count and countdown` (sem preço de lance em nenhum campo);
- [ ] `filters by status` (os 10 mercados de E2E da testnet aparecem como históricos);
- [ ] `refreshes on new ledger without refetching finished markets` (cache do Query).

### 3.2 — Detalhe, progresso do operador e ações permissionless

**Testes primeiro:**
- [ ] `timeline renders watch events in ledger order`;
- [ ] `events older than the RPC window show a notice, not an error`;
- [ ] `operator progress: closed → finalized → settled k/n`, a partir dos eventos;
- [ ] `allocation column appears only after Finalized`;
- [ ] tabela `actions by status × mode × ledger` (lance, fechar, cancelar por timeout, abrir, cancelar);
- [ ] `close market calls auction.closeMarket with the connected signer`.

---

## 4 · Empresa

### 4.1 — Painel

**Testes:** [ ] `prerequisites checklist reflects account, backup, XLM and quota balance`; [ ] `my markets filters by seller`.

### 4.2 — Wizard de criação

**Testes primeiro:**
- [ ] tabela de validação local = `checkMarketParams` (os 5 códigos `Factory.*`), sem chamada à carteira;
- [ ] `closing date converts to closeLedger within 30 days`;
- [ ] `summary shows 10% house fee and seller net per quota`;
- [ ] `createMarket uses StaticRegisterDataProvider and returns the Factory's id`;
- [ ] `SellerNotRegistered sends the user to account setup`;
- [ ] integração na testnet: `company creates a market through the app services`.

### 4.3 — Abrir e cancelar

**Testes:** [ ] `open only in Created`; [ ] `quota balance moves to escrow after open` (integração); [ ] `cancel in Open with bids shows HasBids`.

### 4.4 — Recebimentos

**Testes:** [ ] `proceeds lists only settled winners with net received`; [ ] `a settled winner with received null shows "valor fora do histórico do RPC"` (S-23); [ ] `sync + merge flow from proceeds screen`; [ ] `losers' prices are never shown`.

---

## 5 · Investidor

### 5.1 — Checklist do lance

**Trustline.** O mercado guarda só o endereço do SAC das cotas (`quotaAsset`, `C…`). Para o `changeTrust` clássico, o front precisa do ativo `CODE:ISSUER`, que é o `name()` do SAC (leitura por simulação, sem assinatura). O SDK não oferece isso (F-14, item 4): fica em `app/src/wallet/classic.ts`, com `@stellar/stellar-sdk` 14.6.1. Depois do `changeTrust`, a checagem é a do SDK (`QuotaPort.hasTrustline`, a mesma que o `prepareBid` faz).

**Testes:** [ ] `quota asset is resolved from the SAC name() (CODE:ISSUER)`; [ ] `missing trustline offers changeTrust and rechecks`; [ ] `insufficient balance links to deposit`; [ ] `quantity > total quotas warns`.

### 5.2 — `prepareBid`

**Testes primeiro:**
- [ ] `below min price shows BelowMinPrice and makes no wallet call`;
- [ ] tabela de preflight → mensagens (`MarketNotOpen`, `BiddingClosed`, `MarketFull`, `AlreadyBid`, `InsufficientBalance`, `KeyNotFound`, `ProofFailed`);
- [ ] `prover warmed on screen open`;
- [ ] `register_participant signature only when not registered`;
- [ ] `DepositRevealsPrice warning shown on confirmation`.

### 5.3 — Confirmação, `placeBid` e recuperação

**Testes primeiro:**
- [ ] `wallet signs set_spender then submit_bid` (ordem);
- [ ] `error after lock shows recover screen` (`recovery: revoke_spender`) e `recoverCollateral succeeds`;
- [ ] `DelegationAlreadyExists explains revoke first`;
- [ ] `price is dropped from memory after success` (estado do formulário limpo);
- [ ] browser + testnet: `bid accepted end to end in Chromium`.

### 5.4 — Meus lances

**Testes:** [ ] `shows requested, filled, status and decrypted refund`; [ ] `Settled with refund null shows the RPC window notice` (S-23); [x] `sync + merge refund` (`app/test/flows/my-bids.test.tsx`: o painel mostra o `receiving` on-chain, não o histórico de reembolsos); [x] `recover button only when a live delegation exists` (`app/test/flows/my-bids.test.tsx`: mercado `Cancelled`, ou `Closed` com o `finalize_by_ledger` vencido, e lance `Pending`; nunca com o lance em jogo).

---

## 6 · Ponta a ponta

### 6.1 — Leilão completo na testnet com o operador externo

**Objetivo:** pelo app, um leilão vai de `Created` a `Settled`, com o **seu** sistema do operador rodando e usando o `sk_op` do `register_data` configurado.
**Testes:**
- [ ] cenário Aurora reduzido ([TESTING §5.1](TESTING.md#51-valores-do-cenário-na-testnet)): empresa e investidores pelo app, operador externo, resultados conferidos nas telas;
- [ ] cenário de timeout (operador parado): `cancel_expired` pelo app (~10 min depois do fechamento, carência de 120 ledgers) → reembolso pelo `settle` do operador, ou `recoverCollateral` se ele não voltar.

**Sem o operador pronto:** o teste roda o keeper do SDK (`@zolvency-cmi/operator`) **dentro do teste**, nunca no app, com o `sk_op` provisório da F-03 (a).

---

## 7 · Qualidade

### 7.1 — Auditoria de segredos (F-11)

[x] `no bid price in storage, URL, console, query cache or DOM after submit`, para os fluxos 5.2–5.4 e 2.5.
  Em `app/test/flows/bid-flow.test.tsx`, com os fakes do SDK: preço `777_777_777n`, auditoria depois do envio
  (`assertNoSecretLeak` em storage, URL, console e cache), no erro pós-trava e a recuperação do colateral.
  2.5 e 5.4 não recebem preço de lance — a auditoria deles é a garantia de que o valor não foi persistido.

### 7.2 — E2E Playwright na testnet

O roteiro do [TESTING §5](TESTING.md#5-e2e-e2e), com a carteira dev. **Pronto quando:** verde de ponta a ponta na testnet (~30–60 min, como o E2E do SDK lá).

### 7.3 — Build e documentação

- [ ] `pnpm build` de produção com CSP e sem erros de COEP;
- [ ] README com o passo a passo (`sync:deployment`, `token:issue`, `dev`);
- [ ] PR único `fase/2-app → main`.

---

## Depois do MVP

Saque (`withdraw`, SDK-C), chave confidencial derivada da assinatura da carteira (S-10), indexador para histórico completo (F-08), índice de mercados por carteira, mainnet.
