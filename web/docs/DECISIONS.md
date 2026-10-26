# Decisões do front-end

Decisões tomadas neste repositório, com o prefixo **F-** para não se confundir com:
- **S-01..S-21**: decisões do SDK (`sdk/docs/DECISIONS.md`);
- **D-01..D-21**: decisões dos contratos;
- **D1–D22**: ADR-024 do `specs`.

| Status | Significado |
|---|---|
| **ADOTADA** | vale; mudar exige uma nova entrada aqui |
| **PROPOSTA** | recomendação, à espera de confirmação do dono do projeto |
| **ABERTA** | precisa de decisão antes do passo indicado |

| # | Tema | Status |
|---|---|---|
| F-01 | Stack: Vite + React + TS estrito + TanStack Query + Tailwind | ADOTADA (2026-10-20) |
| F-02 | SDK consumido pelo submódulo, num workspace pnpm | ADOTADA (2026-10-20) |
| F-03 | `register_data` estático; `sk_op` de desenvolvimento trocável por `.env.local` | ADOTADA (2026-10-20) |
| F-04 | O operador é um sistema separado, fora deste front | ADOTADA (2026-10-20) |
| F-05 | Carteiras: Freighter + carteira de desenvolvimento | ADOTADA (2026-10-20) |
| F-06 | Rede: testnet, com o deploy `v0.1.0-rc.4` já feito | ADOTADA (2026-10-20) |
| F-07 | "Conta empresa" é um modo de UI, sem registro on-chain | ADOTADA (2026-10-20) |
| F-08 | Aberturas do saldo: persistência e ressincronização ficam no SDK | ADOTADA (2026-10-20), depende de 2 passos no SDK |
| F-09 | Prova no navegador: Prover único, pré-aquecido | ADOTADA (padrão aceito em 2026-10-20) |
| F-10 | Tempo: duração ↔ ledger, sem data de calendário na tela | ADOTADA (revisada em 2026-10-21) |
| F-11 | Política de segredos no front | ADOTADA |
| F-12 | Guarda do depósito: sugestão de valor que não revela o preço | ADOTADA (padrão aceito em 2026-10-20) |
| F-13 | Script do token de teste das cotas, na testnet | ADOTADA (2026-10-20) |
| F-14 | Lacunas do SDK são resolvidas no SDK, não no front | ADOTADA (2026-10-20) |
| F-15 | Desenvolvimento numa fase só, PR único | ADOTADA (2026-10-20) |
| F-16 | Idioma: inglês (en-US) | ADOTADA (revisada em 2026-10-20) |
| F-17 | Identidade visual da Zolvency | ADOTADA (2026-10-20) |
| F-18 | SDK-A/B na branch `fase/7-conta-navegador` do SDK, a partir da `main` | ADOTADA (2026-10-20) |
| F-19 | CRS do UltraHonk vem do endpoint oficial da Aztec | ADOTADA (2026-10-20) |

---

## F-01 — Stack · ADOTADA (2026-10-20)

Vite 7.3.6 (a versão já medida com o SDK no `examples/bidder-web`), React 18, TypeScript com os mesmos flags do SDK (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), React Router, TanStack Query, React Hook Form + Zod, Tailwind. Testes com Vitest + Testing Library + Playwright 1.55.1 (a mesma versão do SDK).

**Por quê.** É o mesmo bundler e o mesmo runner do SDK. TanStack Query resolve cache e revalidação das leituras da rede, que são muitas (`markets.list` faz várias chamadas por mercado).

**Alternativas.** Next.js (SSR não ajuda: o app é 100% cliente e precisa de COOP/COEP e WASM); Vue/Svelte (ok, mas menos opções de carteira prontas).

---

## F-02 — SDK pelo submódulo, num workspace pnpm · ADOTADA (2026-10-20)

**Contexto.** Os pacotes `@zolvency-cmi/*` estão prontos para o npm, mas **não publicados** (passo 6.5 do SDK). O `core` depende do `@ctd/sdk`, que vem de um submódulo do SDK e é compilado no `postinstall`.

**Decisão.** O workspace pnpm do front inclui `sdk/packages/*` e `sdk/third_party/stellar-confidential-token-demo/packages/sdk`. O app usa `workspace:*`. Exige os submódulos do front **e** os do SDK: `git submodule update --init` na raiz e depois `git -C sdk submodule update --init`. **Não** use `--recursive`: o `specs` tem um gitlink sem URL (`projetos/rs-soroban-ultrahonk`) e o comando falha. Os repositórios são privados e clonam por SSH (README da raiz).

**Consequências.**
- `@stellar/stellar-sdk` fica fixado em 14.6.1, como no SDK.
- Quando o SDK for publicado, troca-se só a versão no `package.json`.
- Os artefatos vêm do modo dev do SDK (`dev-sources.json`) até haver uma release instalada (`fetch-artifacts.sh`), como no `bidder-web`.

**Ambiente (resolvido em 2026-10-20).** Submódulos do SDK inicializados por SSH, pnpm 10.34.6 via corepack.

---

## F-03 — `register_data` estático · ADOTADA (2026-10-20)

**Contexto.** O `createMarket` do SDK pede um `RegisterDataProvider` ("implementado pela API do back-end"). Mas a D-02 dos contratos, verificada no passo 4.3 do SDK, mostra que o `register_data` **não depende do mercado**: é o mesmo para todo mercado do mesmo token. Ele é público (payload `Y_op`, `PVK_op` + prova).

**Decisão.** O `register_data` (base64) fica em `app/public/config/testnet.json`. O app implementa `StaticRegisterDataProvider.forNextMarket()` com `factory.nextMarketId()`, `factory.predictMarketAddress()` e esses bytes. O front **não tem** e nunca usa o `sk_op`.

**Consequência.** Os mercados criados pelo app registram o `Y_op` desse `register_data`. Só o operador que tem o `sk_op` correspondente consegue fazer o `settle` deles. Então o dado **tem que vir do sistema do operador** (F-04): ele exporta o `register_data` uma vez (`CmiOperator.registerDataForNextMarket().registerData`), e o front o recebe como configuração.

**Decidido (2026-10-20): opção (a), parametrizada.** Enquanto não houver um `sk_op` definitivo, usa-se um de desenvolvimento, e trocar de um para outro é mudar uma variável e rodar um comando:

```bash
# .env.local  (raiz do repositório; no .gitignore; NUNCA lido pelo Vite)
CMI_OPERATOR_SPENDER_KEY=<hex do sk_op>     # mesmo nome do examples/operator-node do SDK
# ou, quando o operador já exporta o dado pronto:
CMI_REGISTER_DATA=<base64>
```

- `pnpm register-data`:
  - com `CMI_REGISTER_DATA`, só o grava no config;
  - senão, com `CMI_OPERATOR_SPENDER_KEY`, gera com o `buildRegisterData` do `@zolvency-cmi/operator`;
  - sem nenhuma das duas, **gera** um `sk_op` de desenvolvimento (`cryptoRng.scalar()`), grava-o no `.env.local` e avisa uma vez no terminal: "importe este `CMI_OPERATOR_SPENDER_KEY` no sistema do operador".

  O resultado vai para `app/public/config/testnet.json` (`registerData`, base64), junto com `operatorKeyId` (sha256 do `Y_op`, público) para identificar qual chave está em uso.
- **Trocar para o definitivo:** pôr o novo valor no `.env.local` e rodar `pnpm register-data`. Nada no código muda.
- O `sk_op` nunca vai para `app/`, para o bundle, para log nem para o git. O lint do 0.1 falha se `app/` ler `CMI_OPERATOR_*`; o Vite só expõe variáveis `VITE_*`.
- **Atenção na troca:** cada mercado guarda o `Y_op` da chave com que foi criado. Os mercados criados com a chave de desenvolvimento só podem ser liquidados por quem tem essa chave. Na troca, o operador precisa terminar ou deixar expirar esses mercados com a chave antiga (o timeout devolve tudo em ~10 min na testnet). O app mostra, no detalhe do mercado, se ele foi criado com outra chave que não a atual (compara o `Y_op` registrado no token com o `operatorKeyId` do config).

---

## F-04 — O operador é um sistema separado · ADOTADA (2026-10-20)

**Decisão.** O operador (keeper: `finalize` com a prova `winner_allocation`, `settle` de cada lance, guarda das chaves `sk_op` e do envelope) é **outro sistema**, construído à parte sobre o `@zolvency-cmi/operator`. Este front não tem tela, rota, script nem chave do operador.

**O que o front faz no lugar dele:**
- mostra o progresso do operador pelos eventos públicos da Auction (`MarketClosed` → `MarketFinalized` → `BidSettled` ×N → `MarketSettled`);
- oferece, a qualquer carteira, as ações **permissionless**: `close_market` (depois do `closeLedger`) e `cancel_expired` (depois do `finalizeByLedger`), que pagam 0,5 XLM da reserva a quem chama;
- mostra o prazo do operador (`finalizeByLedger`) e, se ele passar, o caminho de reembolso (cancelar por timeout e, se preciso, `recoverCollateral`).

**Interface com o sistema do operador:** só o `register_data` (F-03) e os endereços do deploy. Não há API entre os dois.

**Consequência nos testes.** O E2E do front cobre até o `Closed` e o caminho de timeout. O caminho `finalize` → `settle` → recebimentos é testado com o seu operador rodando na testnet (passo 6.1), ou com o keeper do SDK chamado **pelo teste** (nunca pelo app).

---

## F-05 — Carteiras · ADOTADA (2026-10-20)

- **Freighter**, via Stellar Wallets Kit, adaptada ao `WalletAdapter` do SDK (`walletSigner`), na rede Testnet.
- **Carteira de desenvolvimento:** keypairs gerados e guardados no navegador, com `keypairSigner`, financiados pelo friendbot da testnet. Serve para simular empresa e vários investidores no mesmo navegador e para o E2E com Playwright, já que a Freighter não é automatizável. Fica visível só com `VITE_DEV_WALLET=1` (nunca no build público).
- Operações clássicas que o SDK não cobre (trustline, saldo XLM público, friendbot) usam `@stellar/stellar-sdk` 14.6.1 e a mesma carteira para assinar.

---

## F-06 — Rede: testnet, com o deploy já feito · ADOTADA (2026-10-20)

**O deploy existe** e está na `main` dos contratos (`deployments/testnet.json`, merge `4695220`, PR #29), com a evidência do E2E do SDK na testnet: **19 PASS, 0 FAIL, ~75 min**. A tag `v0.1.0-rc.4`, para onde o submódulo do SDK aponta, é anterior e não tem o arquivo. Conferido em 2026-10-20: a Factory responde na testnet, e `next_market_id = 11` (10 mercados já criados pelos E2E).

| Item | Valor |
|---|---|
| RPC | `https://soroban-testnet.stellar.org` |
| Passphrase | `Test SDF Network ; September 2015` |
| Factory | `CCI7H273R7ECLXFMXHCNK4YI6Z6D6I66GTWPDU4JDL5HZZI35EMVJ32H` |
| Confidential Token | `CDD7G3P4RLDV3UPE4TH7N3HMR64OTJNUC7TTJVOT6L7IUHVSXQFVCVM6` |
| Auditor | `CCMU4OI2XPQWVNAW4WXR3HYKQTBB6QC2YSGYNMK6RJKD4MJI27VIRA7E` (id 0) |
| XLM (SAC, `underlying`) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| `auction.wasm` | `2215016a…` (o mesmo dos bindings do SDK; S-18) |
| Carência de finalização | **120 ledgers (~10 min)**, não 2 dias: é o deploy de teste (ADR-027) |
| Implantado no ledger | 5.281.761 |

**Decisão.**
- `app/public/config/testnet.json` é gerado por `scripts/sync-deployment.ts` a partir do `deployments/testnet.json` da `main` dos contratos (lido com `git show origin/main:deployments/testnet.json` no submódulo, sem mudar o checkout, ou de um caminho dado) e conferido contra a rede (Factory, `PlatformConfig`, hash do WASM da Auction).
- Os artefatos do navegador são os de `dev-sources.json` do SDK, que batem com as VKs do deploy (`token_vks` e `vk_sha256` da evidência). O `sync-deployment.ts` confere isso.
- A carência e o `finalizeByLedger` vêm sempre da `MarketConfig`/chain de cada mercado (S-21). A UI mostra o prazo do operador; com 120 ledgers, ~10 min depois do fechamento já dá para cancelar por timeout.
- Rede local (quickstart): fora do escopo; o código não depende dela.

**Riscos.**
- Se os contratos forem reimplantados, os endereços mudam: basta rodar o `sync-deployment.ts` de novo.
- A testnet é compartilhada e é zerada periodicamente pela SDF (reset). Depois de um reset, é preciso reimplantar a plataforma.
- **A RPC pública retém ~7 dias de eventos.** Isso afeta a linha do tempo (`watch`), os recebimentos (`proceeds`, `bidder.status`) e a ressincronização do saldo (F-08). Mercados com mais de ~7 dias aparecem sem histórico de eventos.

---

## F-07 — "Conta empresa" é um modo de UI · ADOTADA (2026-10-20)

**Contexto.** Não existe papel de empresa on-chain: qualquer carteira com conta confidencial pode chamar `create_market`. E não há KYC no MVP (ADR-011, jornada do usuário).

**Decisão.** O "login" é conectar a carteira e escolher **Empresa** ou **Investidor**. Empresa abre a interface de empresa; o primeiro acesso registra a conta confidencial (exigida pela Factory) e pede o backup. A escolha fica no `localStorage` por endereço, e dá para trocar pelo cabeçalho. Sem nome, cadastro ou verificação.

---

## F-08 — Aberturas do saldo: persistência e ressincronização no SDK · ADOTADA (2026-10-20)

### O problema

O Confidential Token guarda na chain só **commitments** do saldo (`C = v·G + r·H`): um ponto que esconde o valor `v` com o fator aleatório `r`. Para gastar (no lance, o `set_spender` prova que `saldo − colateral ≥ 0`), o usuário precisa conhecer a **abertura** `(v, r)` do saldo gastável. A chain não guarda a abertura. Hoje o SDK a mantém assim (S-20):
- cada operação feita pelo próprio SDK (register, deposit, merge, set_spender, revoke, receive) calcula a abertura nova e a grava num `OpeningStore`;
- antes de usar, `verifiedOpenings` confere se `pedersenCommit(v, r)` é igual ao commitment on-chain. Se não for, lança `BalanceOutOfSync` **antes** de qualquer transação, porque uma abertura errada geraria uma prova que o token recusa depois de o usuário assinar;
- o SDK só traz o `MemoryOpeningStore`, ou seja, as aberturas ficam em memória.

### Quando quebra

| Situação | Com o SDK atual |
|---|---|
| F5 / fechar e abrir o navegador | as aberturas somem; a próxima operação dá `BalanceOutOfSync`, e o saldo fica inutilizável no app |
| Outro navegador ou computador (com o backup da chave importado) | não há aberturas; `BalanceOutOfSync` |
| Uma transferência que o app não viu | `BalanceOutOfSync` até um `receive` (hoje: `sync`, SDK-B) |

O dinheiro **não se perde**: o saldo continua na chain, e a chave (`sk`, com backup) é suficiente para recuperá-lo. O que falta é o código que reconstrói a abertura a partir da chain.

### Por que dá para reconstruir só com a chave (análise do código)

As fórmulas já existem no SDK. Falta só o laço que lê os eventos e as aplica:

| Evento do token (dono = eu) | Efeito na abertura | Fórmula no SDK |
|---|---|---|
| `deposit` | a receber += `(valor público, r = 0)` | `addOpenings` |
| transferência recebida (`spender_transfer` para mim: reembolso do settlement ou pagamento à empresa) | a receber += `(v_tx, r_tx)`, decifrados por ECDH com a minha `vk` | `decryptIncomingTransfer` (já usado no `account.receive` e no `account.sync`) |
| `merge` | gastável += a receber; a receber = 0 | `addOpenings` (soma módulo a ordem da Grumpkin) |
| `set_spender` (meu lance) e `revoke_spender` (recuperação) | gastável = abertura **lida direto do evento**: o payload traz `b̃ = v_novo + Poseidon2(vk, σ)` e `σ` | `openSpendableBalance` (`core/token/balance.ts`, exportada mas sem uso no `client`) |

Esse é o mesmo modelo do `StateEngine` do `@ctd/sdk` (`state/engine.ts`, submódulo do SDK). Ele reconstrói pelo stream de eventos, mas não conhece os eventos de *spender* (`set_spender`, `revoke_spender`, `spender_transfer`), que são os que o CMI usa. Por isso o SDK do CMI não pode reaproveitá-lo direto.

**Consequência prática no fluxo do leilão.** Todo lance faz um `set_spender`, que "reancora" o gastável num valor legível do evento. Então, para o investidor, basta o último `set_spender`/`revoke_spender` mais os eventos posteriores (deposits, merges, reembolsos). Para a empresa, que nunca faz `set_spender`, é preciso o histórico desde o `register`: deposits, os pagamentos recebidos e os merges.

### O limite: a janela de ~7 dias da RPC

A RPC pública da testnet só devolve eventos dos últimos ~7 dias. Se o evento de que a reconstrução precisa é mais antigo, ela não fecha pela RPC:
- investidor sem nenhum `set_spender`/`revoke` nos últimos 7 dias, e com depósitos antigos;
- empresa com recebimentos ou depósitos com mais de 7 dias que não foram persistidos.

Com a persistência (item 1 abaixo), isso só acontece em **outro navegador** ou depois de **limpar os dados** do navegador. Formas de fechar a lacuna, da mais simples para a mais completa:
1. **Persistir e sincronizar com frequência:** o app chama a sincronização ao abrir. Quem usa ao menos uma vez por semana nunca perde a janela (é a regra do próprio `@ctd/sdk`).
2. **Incluir as aberturas no backup:** o `exportBackup` passa a levar também o último estado sincronizado (cifrado pela mesma senha). Restaurar em outro navegador vira: importar e sincronizar a partir do `syncedLedger` do backup.
3. **Indexador** com histórico completo (o `@ctd/sdk` tem um cliente Goldsky). Fica fora do MVP.

### Decisão

Tudo no SDK; o front não implementa nada de protocolo (F-14). Dois passos no SDK (`docs/requests/001-sdk-account-state.md`):
- **SDK-A — `BrowserOpeningStore`:** `OpeningStore` no IndexedDB, cifrado com uma `CryptoKey` não extraível e escopado por (rede, token, conta), no mesmo molde do `BrowserKeyProvider`. É pequeno e não depende de rede.
- **SDK-B — `account.sync({ fromLedger })`:** reconstrói as aberturas pelos eventos do token, com as regras da tabela acima, e confere o resultado contra os commitments on-chain. Faz parte também: o backup com o estado (opção 2), e o `fromLedger` padrão sendo o ledger do `register` da conta ou o `syncedLedger` guardado. **A confirmar no passo:** que o evento do `set_spender`/`revoke_spender` publica `b̃` e `σ`. O payload os carrega; se o evento não os publicar, a leitura vem dos argumentos da transação.

**No front:** ao conectar, o app chama `account.sync()`. Se der `BalanceOutOfSync` mesmo assim (janela perdida), a tela explica a causa e o que fazer (importar um backup mais recente).

---

## F-09 — Prova no navegador · ADOTADA (2026-10-20)

- Um `Prover` por sessão (`createProver` + `browserBackendLoader`), criado e pré-aquecido ao entrar na tela do lance (S-14, recomendação 2), destruído ao sair do app.
- `threads: navigator.hardwareConcurrency` com COOP/COEP, se a Freighter e o Wallets Kit funcionarem sob COEP (conferir no 0.2). Senão, sem isolamento: uma thread, ~8–20 s para as duas provas.
- Prova em Web Worker dedicado (S-14, recomendação 1): avaliar no passo 5.2. O `prepareBid` mistura leitura, uma transação possível (`register_participant`) e provas, então mover tudo para um worker exige que a assinatura volte ao thread principal. Primeiro mede-se a fluidez da UI com o worker interno do bb.js.

---

## F-10 — Tempo: duração ↔ ledger · ADOTADA (2026-10-20, revisada em 2026-10-21)

`closeLedger = ledgerAtual + ceil(duração / segundosPorLedger)`, com a duração pedida em minutos, horas ou dias. `segundosPorLedger` é medido na rede (média dos últimos ledgers) e limitado pelo valor da configuração (5 s na testnet). O limite de 30 dias é conferido em ledgers (`MAX_DURATION_LEDGERS`), pelo `checkMarketParams`.

**Revisão (2026-10-21, pedido do dono do produto):** a UI **nunca mostra data de calendário**. Todo tempo aparece como duração relativa ao ledger atual ("in 5 minutes", "5 days ago", contagem regressiva), marcada como **estimada**, com o ledger exato ao lado ou num tooltip. O assistente de criação pede a duração, não uma data. O teste `never shows a calendar date` (`app/test/unit/boundaries.test.ts`) barra `Intl.DateTimeFormat`, `toLocale{Date,Time}String`, `toISOString` e campos de data no `app/src`.

---

## F-11 — Política de segredos no front · ADOTADA

- São segredos (S-16): preço, `price × qty`, chaves e aberturas.
- O preço existe só no estado do formulário e no `PreparedBid`. Ele não vai para URL, `localStorage`, `sessionStorage`, cache persistido do TanStack Query, log, Sentry/analytics nem `key` de query.
- Erros mostram só o `code` traduzido.
- Sem telemetria de terceiros.
- Teste de auditoria (TESTING §3.3) em todo fluxo com preço.

---

## F-12 — Guarda do depósito · ADOTADA (2026-10-20)

O valor de `deposit` é público, e depositar exatamente `price × qty` revela o preço (ADR-024; o SDK avisa `DepositRevealsPrice`). A tela de depósito **não recebe o preço do lance** e oferece "Sugerir valor": um valor redondo acima do necessário. No lance, se o SDK devolver `DepositRevealsPrice`, a confirmação mostra o aviso e oferece cancelar.

---

## F-13 — Token de teste das cotas, na testnet · ADOTADA (2026-10-20)

`pnpm token:issue --to <G… da empresa> --code QUOTA --amount 1000 [--holder-secret S…]`, na **testnet**:
1. cria um emissor novo e o financia pelo friendbot da testnet;
2. **sem** clawback (D18; flags do emissor conferidas);
3. abre a trustline da empresa, o que exige a assinatura da empresa:
   - com `--holder-secret` (carteira dev), o próprio script assina;
   - com a Freighter, o script para e imprime a instrução. O app tem o botão **"Habilitar ativo"** (`changeTrust` assinado pela carteira), e depois `pnpm token:issue --resume` paga;
4. paga `amount` cotas (1 cota = 1 unidade clássica de 7 casas = `QUOTA_UNIT` unidades base);
5. implanta o SAC (ou reaproveita, se já existir) e imprime o `C…`, que é o `quota_asset` do leilão. Grava `{ code, issuer, sac }` em `.local/tokens.json`, que o app lê em modo dev para preencher o wizard.

Reaproveita a lógica do `issueQuotaAsset` do `packages/testing` do SDK, que hoje lê a rede de `testNetwork()` (`setTestNetwork(TESTNET)`). O `packages/testing` é privado e só entra no script, nunca no app. Com `VITE_DEV_WALLET=1`, o app também tem o botão "Gerar token de teste", que faz o mesmo com a carteira dev da empresa.

---

## F-14 — Lacunas do SDK resolvidas no SDK · ADOTADA (2026-10-20)

O front não reimplementa protocolo. As lacunas são resolvidas **no SDK**, em passos com TDD, no fluxo de lá (fase → `development` → `main`, com submódulo atualizado aqui depois). Pedidos em `docs/requests/`.

| # | Lacuna | Precisa mudar o SDK? | Efeito se não for feito | Passo do SDK |
|---|---|---|---|---|
| 1 | Aberturas só em memória (F-08) | **Sim**: `BrowserOpeningStore` | F5 quebra o saldo; **bloqueia o MVP** | SDK-A |
| 2 | Sem ressincronização por eventos (F-08) | **Sim**: `account.sync()` + backup com estado | outro navegador / dados limpos = saldo inutilizável no app | SDK-B |
| 3 | Sem `withdraw` no `client` | Sim, **fora do MVP** (2026-10-20) | o XLM recebido (empresa) ou reembolsado fica no saldo confidencial: dá para usá-lo em novos lances, mas não para voltar a XLM público | SDK-C (futuro) |
| 4 | Sem trustline no `client` | Não | o front faz `changeTrust` com `@stellar/stellar-sdk` (operação clássica, fora do protocolo) | — |
| 5 | `markets.list()` lê mercado por mercado | Não para o MVP | lento com muitos mercados; o front usa cache | — |
| 6 | Sem `register_data` para o front | Não | vem do sistema do operador (F-03) | — |
| 7 | Leitores de eventos falhavam com ledger fora da janela do RPC (`proceeds`, `status`, `watch`) | **Sim**: passo 7.3 do SDK (S-23) | as telas de recebimentos, meus lances e linha do tempo quebrariam ~7 dias depois do leilão | 7.3 do SDK |

**Ordem:** SDK-A e SDK-B antes do bloco 2 do front (feitos: `main` do SDK, `a72c9a4`); 7.3 antes dos passos 3.2, 4.4 e 5.4 (feito: `main` do SDK, `0693e1f`); SDK-C fica para depois do MVP.

---

## F-15 — Desenvolvimento numa fase só · ADOTADA (2026-10-20)

**Contexto.** O SDK foi feito em 7 fases, com um PR por passo e promoção por fase.

**Decisão.** O front é planejado em passos com testes primeiro, mas desenvolvido **de uma vez**: dois commits por passo (vermelho, verde) e **um PR** para `main` no fim, com o E2E da testnet verde. O ROADMAP continua sendo a única fonte de status.

**Branches (2026-10-20):**
- `fase/1-mvp`: o planejamento (`docs/`), já na `main` (PR #1).
- `preparacao/dev`: a preparação para o desenvolvimento (passo 0.0: skill, `CLAUDE.md`/`AGENTS.md`, README de setup, `.gitignore`, `.env.example` e as correções do planejamento). Vai para a `main` por PR, antes de o desenvolvimento começar.
- **`fase/2-app`: o desenvolvimento**, do passo 0.1 ao 7.3, criada a partir da `main` depois do merge da `preparacao/dev`. Um PR final para a `main`.
- Push, PR e merge: quem desenvolve faz o push; o dono do projeto revisa e faz o merge.

---

## F-16 — Idioma · ADOTADA (revisada em 2026-10-20)

Interface em **inglês (en-US)**: números com vírgula de milhar e ponto decimal (`formatXlm`, `formatQuotas`), datas em `Intl` `en-US`. Os textos ficam junto das telas (não há camada de i18n enquanto só existe um idioma). Código e identificadores em inglês, como no SDK. Comentários e docs em português.

**Mudança:** a decisão original era pt-BR; o pedido do projeto passou a ser inglês antes do fim do bloco 7, e a tradução foi feita junto com os testes, o E2E e este registro.

---

## F-17 — Identidade visual da Zolvency · ADOTADA (2026-10-20)

**Referência:** https://www.zolvency.xyz/ (Next.js + Tailwind v4 + tokens no estilo shadcn/ui, extraídos do CSS publicado em 2026-10-20).

| Token | Claro | Escuro |
|---|---|---|
| `--background` | `#f8fafc` | `#030712` |
| `--foreground` | `#0f172a` | `#f3f4f6` |
| `--card` | `#ffffff` | `#0b0f19` |
| `--primary` (ação, foco, links) | `#635bff` | `#635bff` |
| `--primary-foreground` | `#ffffff` | `#ffffff` |
| `--secondary` / `--muted` | `#f1f5f9` | `#1f2937` |
| `--muted-foreground` | `#64748b` | `#9ca3af` |
| `--accent` (destaque, ZK/provas) | `#00d4b2` | `#00d4b2` |
| `--success` | `#10b981` | `#10b981` |
| `--destructive` | `#ef4444` | `#991b1b` |
| `--border` / `--input` | `#e2e8f0` | `#1f2937` |
| `--ring` | `#635bff` | `#635bff` |
| `--radius` | `1rem` | `1rem` |

- **Tipografia:** Plus Jakarta Sans (texto e títulos, com peso forte: `font-bold`/`font-black`), Inter (fallback) e JetBrains Mono (rótulos técnicos, endereços, hashes, valores, ledgers; caixa alta com `tracking-widest` nos rótulos).
- **Fontes servidas pelo próprio app** (`@fontsource/*`), sem Google Fonts nem CDN, por causa da CSP (F-11).
- **Componentes:** estilo shadcn/ui (Radix + Tailwind) com esses tokens; ícones `lucide-react`; cartões `rounded-2xl` com `border-border`; botões e selos `rounded-full`; cabeçalho fixo com `backdrop-blur`.
- **Marca no cabeçalho:** quadrado `bg-primary rounded-lg` com o ícone `shield` em branco + "ZOLVENCY" em mono, caixa alta, e o rótulo do produto abaixo em `text-primary` ("Auctions", no lugar do "Proofs" do site).
- **Tema claro e escuro**, com alternância no cabeçalho (classe `.dark`), como no site.
- **Tom:** inglês (en-US, F-16), frases curtas e técnicas, sem promessas que o MVP não cumpre (ver a limitação da chave do envelope em ARCHITECTURE §7).
- **Ativos:** o favicon (`icon.svg`, `icon-light/dark-32x32.png`) é baixado do site no passo 0.5 e versionado em `app/public/`, com a origem anotada.

---

## F-18 — SDK-A/B na branch `fase/7-conta-navegador` do SDK · ADOTADA (2026-10-20)

**Contexto.** O SDK não tem branch `development` no remoto. As correções que a testnet exigiu (`fase/6-testnet`, entre elas o `ChainClient.invoke` relendo a conta quando um nó do RPC ainda não a vê) foram promovidas para a `main` do SDK (`37b7e2f`, PR #9) em 2026-10-20.

**Decisão.**
- A branch `fase/7-conta-navegador` do SDK saiu da `main` (`37b7e2f`) e trouxe a fase 7: 7.1 = SDK-A e 7.2 = SDK-B, documentadas no `docs/ROADMAP.md`, `docs/API.md` e `docs/DECISIONS.md` (S-22) do SDK e nos CHANGELOGs de `core` e `client`. **Mergeada na `main` do SDK em 2026-10-20 (`a72c9a4`, PR #10).**
- O passo 7.3 (S-23, janela de eventos do RPC) foi feito na branch `fase/7-janela-eventos` do SDK e **mergeado na `main` do SDK (`0693e1f`, PR #11)**.
- O submódulo `sdk` do front aponta para a `main` do SDK (`0693e1f`).

---

## F-19 — CRS do UltraHonk vem do endpoint oficial da Aztec · ADOTADA (2026-10-20)

**Contexto.** O `bb.js` 0.87 baixa o CRS (Common Reference String, `g1.dat`/`g2.dat`) de `https://crs.aztec.network` na primeira prova e o guarda no IndexedDB. O SDK não expõe como trocar essa origem, e o arquivo é grande demais para versionar no app.

**Decisão.** A CSP libera `https://crs.aztec.network` em `connect-src` e `data:` (o wasm comprimido do próprio `bb.js`). Isso não é telemetria nem script de terceiro: é dado público de setup do provador, buscado com `Range` e cacheado. O app continua sem analytics e sem qualquer outro host externo; a lista completa está no CSP de `app/vite.config.ts`.

**Consequência.** A primeira prova exige rede para o CRS (dezenas de MB, uma vez por navegador). Depois disso, as provas seguintes reusam o IndexedDB. Se um dia o SDK aceitar um CRS local, o app deve servi-lo em `/artifacts/crs/` e remover o host da CSP.
