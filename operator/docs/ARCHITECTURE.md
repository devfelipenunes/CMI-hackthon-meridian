# Arquitetura do back-end do operador

Como o serviço é dividido, como ele sabe quando agir em cada mercado, e como usa o SDK. A interface detalhada (HTTP, banco, módulos) está em [API.md](API.md).

---

## 1. Onde o serviço fica no sistema

```text
   Front do seller / bidder (outro repositório)          Administrador (curl / Swagger UI)
          │ assina com a carteira                                   │ API key
          │                                                         ▼
          │                       ┌──────────────── operator (este) ────────────────┐
          │                       │  HTTP (Fastify + OpenAPI)                               │
          │  GET /v1/register-data│     │                                                   │
          ├──────────────────────►│     ▼                                                   │
          │                       │  Serviços: discovery · sync · agenda · executor ·       │
          │                       │            alertas · keystore                           │
          │                       │     │                         │                         │
          │                       │     ▼                         ▼                         │
          │                       │  @zolvency-cmi/operator   SQLite (índice, agenda,       │
          │                       │  (CmiOperator, Keeper)     ações, alertas, chaves       │
          │                       │  @zolvency-cmi/core         cifradas)                   │
          │                       └────────────│────────────────────────────────────────────┘
          ▼                                    ▼  assina com o submitter do operador
   ───────────────────────── Stellar RPC (testnet / quickstart local) ─────────────────────────
     Factory · Auction (1 por mercado) · Confidential Token (CMI) · Verifiers UltraHonk · SACs
```

- **Sem front-end próprio.** O único consumidor externo "de produto" é o front do seller, que precisa do `register_data` para criar um mercado (D-02 dos contratos). O resto da API é observação e operação.
- **O serviço não depende de ninguém avisar** que um mercado existe: ele varre a Factory (OP-03).
- **Permissionless não quer dizer opcional.** `close_market`, `finalize`, `cancel_expired`, `settle` e `release_unsettled` podem ser chamados por qualquer um, mas só o operador consegue montar a prova de alocação e os payloads de settlement (`sk_op`, ADR-023). Se o serviço parar, o leilão para (ADR-024 D12).

---

## 2. Como o serviço sabe que um mercado vai fechar (estratégia de agendamento)

### 2.1 O que a chain já diz

Tudo o que importa para o tempo de um mercado é **ledger**, e fica **fixo desde a criação**:

| Valor | Onde se lê | Quando é conhecido |
|---|---|---|
| `close_ledger` | `get_market().params.close_ledger` | na criação (imutável, RF-04) |
| `finalization_grace_ledgers` | `get_market().finalization_grace_ledgers` | na criação (ADR-027) |
| `finalize_by_ledger` | `close_ledger + grace` (gravado no `close_market`) | **calculável desde a criação** |
| ledger atual | `getLatestLedger` do RPC | sempre (~5 s por ledger) |

Então o serviço **não precisa adivinhar nem rodar uma vez por dia**: ele sabe, desde que descobre o mercado, o ledger exato em que vai precisar agir.

### 2.2 Por que não um cron diário

- **A janela de finalização conta a partir do `close_ledger`, não de quando alguém chama `close_market`.** Um cron diário atrasaria o fechamento em até 24 h e comeria metade da carência de 2 dias. Num ambiente de teste com carência curta (ADR-027, mínimo 12 ledgers ≈ 1 min), o mercado seria cancelado por timeout antes do cron rodar.
- **O settlement é por ledger:** no máximo um `settle` por ledger (cada um usa ~60% da CPU do ledger, ADR-026). Um mercado com 8 vencedores precisa de ≥ 8 ledgers seguidos; um cron não faz isso.
- **Relógio de parede não é o tempo do contrato.** O ledger não dura exatamente 5 s; converter para data só serve para exibição.

### 2.3 A estratégia adotada (OP-04): laço por ledger + agenda por mercado

O serviço é um **daemon** com um laço que acorda a cada ledger (~5 s) e faz **uma** chamada barata ao RPC (`latestLedger`). Cada mercado no banco tem um `next_check_ledger`. Só os mercados vencidos recebem um `tick` do keeper do SDK.

```text
a cada ledger L (laço principal, ~5 s):
  1. L = chain.latestLedger()                                   ← 1 chamada RPC
  2. se L ≥ próxima varredura da Factory → discovery (OP-03)     ← a cada 12 ledgers (~1 min)
  3. mercados vencidos = SELECT … WHERE status não terminal AND next_check_ledger ≤ L
  4. para cada um, em ordem de urgência (OP-17):
       ação = keeper.tick(auction)        ← SDK: relê a chain, planNextAction, executa ≤ 1 ação pesada
       falhou? = algum KeeperEvent "failed" neste tick           ← o tick devolve a ação mesmo se falhou
       next_check_ledger = próxima_checagem(ação, falhou?, L)   ← §2.4
       grava ação, resultado e alertas
  5. dorme até o próximo ledger
```

### 2.4 Quando checar de novo (`próxima_checagem`)

| Ação devolvida pelo keeper | Próxima checagem |
|---|---|
| `wait { untilLedger }` (mercado `Open` antes do fechamento) | `min(untilLedger, L + RECONCILE_LEDGERS)` |
| `close` executado | `L + 1` (já pode finalizar) |
| `finalize` executado | `L + 1` (já pode liquidar) |
| `finalize` falhou | backoff `L + 2^n` (teto `BACKOFF_MAX_LEDGERS`) e alerta; perto do `finalize_by_ledger`, alerta crítico (OP-15) |
| `settle` / `release_unsettled` executado | `L + 1` (próximo bid) |
| `wait { L + 1 }` (outro `settle` já usou este ledger, ou `ResourceContention`) | `L + 1` |
| `done` | mercado terminal; sai da agenda |

`RECONCILE_LEDGERS` (padrão 60 ≈ 5 min) é a **reconciliação**: mesmo longe do fechamento, o serviço relê o mercado de vez em quando, para notar um `cancel_market` do seller, novos lances (só para exibição na API) ou alguém ter fechado o mercado antes.

**Custo.** Um mercado `Open` com 30 dias pela frente custa uma leitura a cada 5 min. O laço principal custa uma chamada por ledger, independentemente do número de mercados.

### 2.5 Reinício

O keeper do SDK **não guarda estado de mercado**: ele relê a chain em todo `tick`. O banco guarda só a lista de mercados e a agenda. Reiniciado, o serviço:
1. carrega os mercados não terminais;
2. põe `next_check_ledger = agora` em todos (um `tick` de cada para se ressincronizar);
3. retoma a varredura da Factory do cursor salvo.

Nada se perde e nada é feito duas vezes: `settle` repetido devolve `AlreadySettled` (D-09 dos contratos), e as outras transições recusam pelo estado.

---

## 3. Descoberta de mercados (OP-03)

A Factory tem um contador público e um registro:

```text
next_market_id()            → começa em 1; o próximo id a ser criado
get_market_address(id)      → endereço da Auction (MarketNotFound se não existe)
```

A varredura é um laço de inteiros, sem depender de eventos:

```text
cursor = meta.factory_cursor (último id já registrado; 0 no início)
next   = factory.nextMarketId()
para id em cursor+1 .. next-1:
    address = factory.getMarketAddress(id)
    versão  = marketVersion(chain, address)            ← S-18: hash do WASM da Auction
    config  = auction.getMarket()
    grava o mercado (supported = versão conhecida), next_check_ledger = agora
    cursor = id
```

**Por que não pelos eventos `MarketCreated`.** O RPC guarda eventos por uma janela curta (S-23 do SDK; da ordem de dias), e um mercado vive até 30 + 2 + 1 dias. Um serviço parado por uma semana perderia mercados. O contador da Factory nunca expira.

**Mercado de versão desconhecida** (`UnsupportedContractsVersion`): fica registrado com `supported = false`, gera um alerta e não entra na agenda. O SDK só prova para um `auction.wasm` que ele conhece.

---

## 4. Módulos do serviço

| Módulo | Pasta | Responsabilidade | Usa do SDK |
|---|---|---|---|
| Config | `src/config/` | lê e valida o ambiente (`.env`) e o `deployments/<rede>.json` no boot; falha cedo | — |
| Logger | `src/observability/logger.ts` | pino com redação de chaves sensíveis; nunca loga `Secret` | `Secret` |
| Banco | `src/db/` | SQLite, migrações SQL versionadas, repositórios (`MarketRepo`, `ActionRepo`, `AlertRepo`, `KeyRepo`, `MetaRepo`, `LeaseRepo`) | — |
| Keystore | `src/keys/` | `DbOperatorKeyStore implements OperatorKeyStore`: chaves cifradas com AES-256-GCM sob a chave mestra (OP-08); CLI de geração/importação | `OperatorKeyStore`, `Secret`, `keypairSigner` |
| Chain | `src/chain/` | monta `ChainClient`, `chainFactoryPort`, `chainAuctionPort` (instrumentado, OP-18), `chainTokenPort`, `Prover` | `core` |
| Boot checks | `src/boot/` | rede certa, artefatos sha256, chaves consistentes, fee wallet registrada, saldo do submitter (OP-13) | `verifyArtifacts`, `TokenPort` |
| Discovery | `src/markets/discovery.ts` | varre a Factory (§3) | `FactoryPort`, `marketVersion` |
| Sync | `src/markets/sync.ts` | copia o estado público do mercado e dos bids para o banco (só dado público) | `AuctionPort`, `TokenPort.isSpender` |
| Agenda | `src/scheduler/` | `nextCheck(action, ledger)` (função pura, §2.4), seleção dos vencidos, backoff, prioridade | `KeeperAction` |
| Executor | `src/runner/` | o laço por ledger (§2.3), lease de instância única (OP-06), pausa, `AbortSignal`, shutdown limpo | `CmiOperator`, `Keeper` |
| Alertas | `src/alerts/` | regras: falha de finalize, `RootMismatch`/`OpeningMismatch`/`CollateralMismatch`, prazo do `finalize_by_ledger`, quarentena, saldo baixo, RPC fora; webhook opcional | `KeeperEvent` |
| API | `src/api/` | Fastify, schemas TypeBox → OpenAPI, Swagger UI, auth por API key | — |
| CLI | `src/cli/` | `keys`, `bootstrap fee-wallet`, `bootstrap auditor-pubkey`, `markets rescan`, `migrate` | `buildRegisterData`, `connectClient` + `AccountApi.ensureRegistered` (`client`) |

**Fronteiras** (checadas por lint, `dependency-cruiser`, como no SDK):
- `api/` não importa `keys/` diretamente (só por serviços que nunca devolvem segredo);
- só `keys/` lê as tabelas de chaves;
- nada fora de `chain/` monta adaptadores do SDK;
- `scheduler/` é puro (sem I/O).

---

## 5. Estrutura de pastas

```text
operator/
├── .env.example · package.json · tsconfig.json · vitest.config.ts
├── eslint.config.js · .dependency-cruiser.cjs · .node-version
├── docs/                               # documentação profunda (ponto de entrada: ../README.md)
├── deployments/                        # <rede>.json (endereços); local.json fora do git
├── migrations/0001_init.sql
├── scripts/
│   ├── setup-sdk.sh                    # submódulos + install/build/test do SDK + install daqui
│   ├── localnet.sh                     # quickstart + deploy pelo SDK → deployments/local.json
│   └── demo-testnet-e2e.sh             # jornada completa na testnet, com log público
├── src/
│   ├── main.ts                         # boot: config → banco → chaves → checagens → laço + API
│   ├── service.ts                      # composição (testável com as portas fake)
│   ├── errors.ts · version.ts
│   ├── config/load.ts                  # ambiente + deployment
│   ├── observability/logger.ts         # pino + redação + adaptador do Logger do SDK
│   ├── db/{open,repos}.ts              # SQLite, migrações, repositórios
│   ├── keys/{seal,store}.ts            # AES-256-GCM, DbOperatorKeyStore (OperatorKeyStore do SDK)
│   ├── chain/{ports,connect}.ts        # ChainPorts, adaptadores do SDK, ChainClient gravado (OP-18), prover
│   ├── boot/{checks,fee-wallet}.ts     # checagens de boot (OP-13); registro da fee wallet (D22)
│   ├── markets/{discovery,sync,register-data}.ts
│   ├── scheduler/next-check.ts         # nextCheck, orderDue, deadlineLevel (puro)
│   ├── runner/{loop,lease}.ts          # o laço por ledger e o lease de instância única
│   ├── alerts/service.ts               # regras, dedup, webhook
│   ├── api/{server,schemas}.ts         # Fastify + TypeBox + OpenAPI/Swagger
│   └── cli/{index,env}.ts              # pnpm cli …
└── test/
    ├── unit/  integration/  api/  proving/  e2e/
    ├── helpers/{world,service}.ts      # rede fake com bids reais; serviço de teste
    └── fixtures/depcruise/             # violações de propósito (checagem das fronteiras)

Fora deste repositório, ao lado dele:
  ../sdk/        protocolo em TypeScript, consumido por link: (OP-02)
  ../specs/      produto, RFs e ADRs
  ../contracts/  interface on-chain e artefatos por release
```

---

## 6. Fluxos

### 6.1 Boot

```text
config válida? ── não → sai com erro claro (sem imprimir valores)
abre SQLite, roda migrações pendentes
lease de instância única (OP-06) ── outra instância viva → espera/encerra
carrega artefatos (release fixada ou dev) e confere sha256          (S-06)
ChainClient.assertNetwork(): passphrase e endereços do deployment   (NetworkMismatch)
keystore: decifra as chaves com a chave mestra; confere:
   · ponto da chave de envelope == BID_VALIDITY_PK_OPERATOR do circuito   (OP-10)
   · submitter existe na rede e tem saldo ≥ mínimo
   · fee wallet registrada no token (senão nenhum mercado pode ser criado, ADR-024 D22)
cria Prover, CmiOperator, Keeper (um só, para o limite global de 1 settle/ledger)
sobe a API; inicia o laço (§2.3)
```

### 6.2 Vida de um mercado visto pelo serviço

```text
Factory.create_market (seller, outro repo)     → discovery grava o mercado (status Created)
Auction.open_market (seller)                   → sync/reconciliação vê Open; agenda = close_ledger
L ≥ close_ledger                               → keeper: close_market                    (RF-16)
Closed                                         → keeper: finalize                        (RF-17..19)
      readBids: decifra envelopes, confere raiz, abertura e colateral
      planAllocation + proveAllocation (winner_allocation)
      finalize(filled, proof)
Finalized                                      → keeper: 1 bid por ledger                (RF-20/21)
      delegação viva  → buildSettlement (3 pernas + settlement_binding) → settle
      delegação morta → release_unsettled
Settled                                        → done; sai da agenda
Closed ∧ L > finalize_by_ledger                → keeper: cancel_expired; depois reembolso de cada bid via settle(filled=0)
Open sem lances no close                        → close_market cancela (no_bids) → done
```

### 6.3 `register_data` para o front do seller

O `register_data` (payload + prova de `register` do token com `sk_op`) **não depende do endereço do mercado**: o mesmo valor serve para todo mercado do mesmo token (D-02 dos contratos). O serviço o gera uma vez (`buildRegisterData`), guarda em cache e o devolve em `GET /v1/register-data` junto com `next_market_id` e o endereço previsto (`registerDataForNextMarket`).

---

## 7. Concorrência e limites

- **Uma instância ativa por rede** (OP-06). Duas instâncias não quebram a segurança (tudo é idempotente ou recusado pelo estado), mas gastam taxa à toa e furam o limite de 1 `settle` por ledger.
- **Um único `Keeper`** no processo: o `KeeperScheduler` do SDK aplica o limite de 1 `settle` por ledger **para todos os mercados** dele.
- **Provas pesadas em série.** `winner_allocation` e as provas de settlement rodam no mesmo `Prover` (bb.js). Um `tick` de finalize pode levar segundos; o laço não começa outro tick pesado enquanto um roda.
- **Prioridade (OP-17):** num ledger com vários mercados vencidos, primeiro os mais perto do `finalize_by_ledger` (risco de timeout), depois `close`, depois settlement.

---

## 8. Segurança

| Regra | Como o serviço cumpre |
|---|---|
| Chaves do operador (ADR-024 D5/D14/D19/D22) | tabela `keys` com AES-256-GCM; chave mestra fora do banco (variável de ambiente ou arquivo com permissão 600); em memória só como `Secret<T>`; nenhuma rota devolve chave privada |
| Preços nunca publicados (G1–G3, S1) | o banco guarda só dado público (quantidades, estados); `DecryptedBid` e `AllocationPlan` vivem só em memória durante o tick; nenhuma rota expõe esses valores |
| Logs sem segredo (SECURITY "Frontend leaks secret", S-16) | redação no pino; `KeeperEvent` já não carrega segredo; logs, respostas e banco são checados contra vazamento |
| Operador não pode mentir (S2, S11) | não depende do serviço: as provas são verificadas on-chain. O serviço só consegue atrasar |
| Alarmes de integridade | `RootMismatch`, `OpeningMismatch`, `CollateralMismatch` geram alerta crítico e **não** geram prova (RF-17) |
| API administrativa | API key (hash no ambiente); rotas de leitura também exigem chave; abertas só `/health` e `/v1/register-data` (dado público, OP-09) |
| Chave de envelope pública na release atual | **aceito no MVP de teste** (OP-10): usa a chave dos POCs; a troca futura é `requests/001`, e o boot garante que a chave bate com o circuito |

---

## 9. Operação

- **Processo:** um daemon com reinício automático (systemd ou o supervisor da sua infraestrutura). Shutdown por `SIGTERM`: termina o tick atual, libera o lease, fecha o `Prover`.
- **Primeira subida** (OP-21): chaves → chave pública do auditor → deploy da plataforma pelo repositório de contratos (`--auditor-key`, `--fee-wallet`) → `bootstrap fee-wallet` → serviço.
- **Quarentena** (OP-19, limitação aceita): um bid em quarentena só volta a ser tentado depois de reiniciar o serviço.
- **Saldo do submitter:** cada transição paga 0,5 XLM ao `caller` a partir da reserva do seller (D-04), e um `settle` custa ~0,29 XLM de taxa (ADR-024 D11): o submitter tende a se pagar, mas precisa de um saldo inicial e de alerta de saldo baixo.
- **Backup:** o arquivo SQLite (com as chaves cifradas) e, **separado**, a chave mestra. Perder `sk_op` impede liquidar qualquer mercado aberto; os bidders só sairiam por `revoke_spender` (OQ-15).
- **Rotação:** `sk_op` e a chave de envelope **não rotacionam** no MVP (D-06 dos contratos: a chave de envelope é constante do circuito).
