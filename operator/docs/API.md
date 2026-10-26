# Interfaces do back-end do operador

O contrato do serviço — para quem o consome e para quem o implementa: API HTTP, configuração, banco e módulos internos. Nomes podem ser ajustados na implementação, mas **toda mudança é refletida aqui no mesmo PR**.

---

## Sumário

1. [API HTTP](#1-api-http)
2. [Configuração](#2-configuração)
3. [Banco (SQLite)](#3-banco-sqlite)
4. [Módulos internos](#4-módulos-internos)
5. [CLI](#5-cli)
6. [Erros e alertas](#6-erros-e-alertas)
7. [Mapa RF → módulo](#mapa-rf--módulo)

---

## 1. API HTTP

Fastify + schemas TypeBox, que geram o OpenAPI 3.1 (`@fastify/swagger`) e a interface do Swagger (`@fastify/swagger-ui`).

- `GET /docs` — Swagger UI. `GET /openapi.json` (e `/docs/json`) — o documento.
- **Auth:** header `x-api-key`. Abertas: `/health` e `/v1/register-data` (OP-09). Duas chaves: `read` e `admin`.
- **Privacidade:** nenhuma resposta tem preço, preço de corte, colateral, valor pago, taxa ou reembolso, mesmo para `admin`.
- **Números:** `bigint` vira string decimal no JSON; ledgers e índices são `number`.
- **Erros:** `{ "error": { "code": "MarketNotFound", "message": "…" } }`, com códigos estáveis (§6).

### 1.1 Saúde e estado

| Método | Rota | Auth | Resposta |
|---|---|---|---|
| GET | `/health` | — | `200 { ok: true }` se o processo está vivo |
| GET | `/ready` | read | `200` se banco, RPC, artefatos, chaves e lease estão OK; `503` com a lista do que falhou |
| GET | `/v1/status` | read | `OperatorStatus` |

```ts
interface OperatorStatus {
  network: "testnet" | "local"; rpcUrl: string; latestLedger: number | null;
  keeper: { running: boolean; paused: boolean; lastLoopLedger: number | null; leader: boolean /* tem o lease (OP-06) */ };
  discovery: { cursor: string /* último market_id */; nextMarketId: string | null; lastScanLedger: number | null };
  submitter: { address: string; xlmBalance: string | null /* stroops; null = conta inexistente ou RPC fora */ };
  feeWallet: { address: string; registered: boolean | null };
  envelopeKey: "poc" | "custom";            // OP-10: "poc" = chave pública dos POCs, só para teste
  versions: { service: string; contracts: string /* tag dos artefatos ou "dev" */ };
  markets: Record<MarketStatus, number>;    // contagem por estado
  openAlerts: number;
}
```

### 1.2 Mercados (somente dado público)

| Método | Rota | Auth | Resposta |
|---|---|---|---|
| GET | `/v1/markets?status=Open,Closed&supported=true&limit=&cursor=` | read | `{ items: MarketSummary[], next: string \| null }` |
| GET | `/v1/markets/{marketId}` | read | `MarketDetail` · `404 MarketNotFound` |
| GET | `/v1/markets/{marketId}/actions?limit=&cursor=` | read | `{ items: ActionView[], next }` |

```ts
interface MarketSummary {
  marketId: string; address: string; seller: string; status: MarketStatus; supported: boolean;
  totalQuotas: number; minPricePerQuota: string /* parâmetro PÚBLICO */; bidCount: number; demand: number /* Σ requested */;
  closeLedger: number; finalizeByLedger: number /* close + grace */;
  estimatedCloseAt: string | null;  // ISO, só exibição: (closeLedger − latest) × SECONDS_PER_LEDGER da rede (OP-22)
  nextCheckLedger: number | null; lastSyncedLedger: number | null;
}
interface MarketDetail extends MarketSummary {
  quotaAsset: string; finalizationGraceLedgers: number; contractsVersion: string | null;
  allocation: number[] | null;        // filled por bid_index, depois do Finalized (público on-chain)
  unsold: number | null;
  bids: { bidIndex: number; bidder: string; participantId: number; requestedQuantity: number;
          filledQuantity: number; status: BidStatus; delegationLive: boolean | null; quarantined: boolean }[];
}
interface ActionView {
  id: number; kind: KeeperAction["kind"]; bidIndex: number | null; ledger: number;
  outcome: "ok" | "already_settled" | "retry" | "failed" | "quarantined";
  code: string | null; txHash: string | null; feeCharged: string | null; cpuInsns: number | null; at: string;
}
```

### 1.3 Alertas

| Método | Rota | Auth | Resposta |
|---|---|---|---|
| GET | `/v1/alerts?open=true&severity=critical` | read | `{ items: AlertView[], next }` |
| POST | `/v1/alerts/{id}/ack` | admin | `204` |

```ts
interface AlertView { id: number; severity: "info" | "warning" | "critical"; kind: AlertKind;
  marketId: string | null; bidIndex: number | null; message: string /* sem segredo */; at: string; ackedAt: string | null }
```

### 1.4 Operação (admin)

| Método | Rota | Efeito |
|---|---|---|
| POST | `/v1/keeper/pause` | o laço continua lendo e sincronizando, mas não envia transações |
| POST | `/v1/keeper/resume` | volta a enviar |
| POST | `/v1/discovery/rescan` | roda a varredura da Factory agora |
| POST | `/v1/markets/{marketId}/resync` | `next_check_ledger = agora` (um tick no próximo ledger) |

Não há rota para tirar um bid da quarentena: limitação aceita (OP-19), o caminho é reiniciar o serviço.

Nenhuma rota manda o serviço executar uma ação específica (`settle`, `finalize`…): quem decide é o `planNextAction` do SDK sobre o estado da chain. A API só acelera ou pausa.

### 1.5 Para o front do seller

| Método | Rota | Auth | Resposta |
|---|---|---|---|
| GET | `/v1/register-data` | — (pública, CORS para `CMI_CORS_ORIGINS`) | `{ marketId: string, address: string, registerData: string /* base64 */ }` |

É o `RegisterDataProvider.forNextMarket()` do `client` do SDK, servido por HTTP. O `registerData` é o mesmo para todo mercado do token (D-02) e fica em cache; `marketId`/`address` são os **previstos** (a Factory devolve os alocados; corrida no id faz o front repetir, como o `createMarket` do SDK já faz).

---

## 2. Configuração

Lida do ambiente no boot e validada com TypeBox. Valores secretos **nunca** são impressos, nem no erro de validação.

| Variável | Obrigatória | Padrão | Uso |
|---|---|---|---|
| `CMI_NETWORK` | sim | — | `testnet` ou `local` |
| `CMI_DEPLOYMENT` | não | `deployments/<rede>.json` | rpc, passphrase, `factory`, `token`, `auditor` |
| `CMI_CONTRACTS_RELEASE` | não | — (modo dev) | tag dos artefatos (`fetch-artifacts.sh`); sem ela, `loadDevArtifacts` |
| `CMI_DB_PATH` | não | `./data/operator.db` | arquivo SQLite |
| `CMI_MASTER_KEY` / `CMI_MASTER_KEY_FILE` | uma das duas | — | 32 bytes (hex/base64) que cifram a tabela `keys` |
| `CMI_API_HOST` / `CMI_API_PORT` | não | `127.0.0.1` / `8080` | — |
| `CMI_API_KEY_READ_SHA256` / `CMI_API_KEY_ADMIN_SHA256` | sim | — | hash das API keys |
| `CMI_CORS_ORIGINS` | não | — | origens do front do seller, só para `/v1/register-data` |
| `CMI_RECONCILE_LEDGERS` | não | `60` | §2.4 da arquitetura |
| `CMI_DISCOVERY_EVERY_LEDGERS` | não | `12` | — |
| `CMI_BACKOFF_MAX_LEDGERS` | não | `120` | backoff de ação de mercado |
| `CMI_DEADLINE_WARN_LEDGERS` | não | `720` (~1 h) | alerta antes do `finalize_by_ledger` |
| `CMI_SUBMITTER_MIN_XLM` | não | `20` | alerta de saldo baixo |
| `CMI_ALERT_WEBHOOK_URL` | não | — | POST de alertas `warning`/`critical` |
| `CMI_SECONDS_PER_LEDGER` | não | 5 (testnet), 1 (local) | só para datas estimadas (OP-22) |
| `CMI_LOOP_INTERVAL_MS` | não | `SECONDS_PER_LEDGER × 1000` | intervalo do laço |
| `CMI_LOG_LEVEL` | não | `info` | — |

---

## 3. Banco (SQLite)

`better-sqlite3` (OP-07), WAL, migrações em `migrations/NNNN_nome.sql` aplicadas no boot. **Só dado público e chaves cifradas.**

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- factory_cursor, schema_version, register_data_cache (base64, público), lease_*

CREATE TABLE markets (
  market_id            TEXT PRIMARY KEY,            -- u64 como texto decimal
  address              TEXT NOT NULL UNIQUE,
  seller               TEXT NOT NULL,
  quota_asset          TEXT NOT NULL,
  total_quotas         INTEGER NOT NULL,
  min_price_per_quota  TEXT NOT NULL,               -- parâmetro público
  close_ledger         INTEGER NOT NULL,
  grace_ledgers        INTEGER NOT NULL,
  finalize_by_ledger   INTEGER NOT NULL,            -- close + grace
  status               TEXT NOT NULL,               -- MarketStatus
  bid_count            INTEGER NOT NULL DEFAULT 0,
  contracts_version    TEXT,                        -- marketVersion (S-18)
  supported            INTEGER NOT NULL,            -- 0/1
  next_check_ledger    INTEGER,                     -- NULL = terminal / fora da agenda
  backoff_attempts     INTEGER NOT NULL DEFAULT 0,
  last_synced_ledger   INTEGER,
  discovered_at        TEXT NOT NULL,
  terminal_at          TEXT
);
CREATE INDEX markets_due ON markets(next_check_ledger) WHERE next_check_ledger IS NOT NULL;

CREATE TABLE bids (
  market_id TEXT NOT NULL REFERENCES markets(market_id),
  bid_index INTEGER NOT NULL,
  bidder TEXT NOT NULL, participant_id INTEGER NOT NULL,
  requested_quantity INTEGER NOT NULL, filled_quantity INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL, delegation_live INTEGER, quarantined INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (market_id, bid_index)
);

CREATE TABLE actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT NOT NULL, kind TEXT NOT NULL, bid_index INTEGER,
  ledger INTEGER NOT NULL, outcome TEXT NOT NULL, code TEXT,
  tx_hash TEXT, fee_charged TEXT, cpu_insns INTEGER, at TEXT NOT NULL
);

CREATE TABLE alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  severity TEXT NOT NULL, kind TEXT NOT NULL, market_id TEXT, bid_index INTEGER,
  message TEXT NOT NULL, dedup_key TEXT NOT NULL, at TEXT NOT NULL, acked_at TEXT
);
CREATE UNIQUE INDEX alerts_open_dedup ON alerts(dedup_key) WHERE acked_at IS NULL;

CREATE TABLE keys (
  name TEXT PRIMARY KEY,               -- spender | envelope | submitter | fee_wallet_stellar | fee_wallet_token | admin
  public TEXT NOT NULL,                -- endereço G… ou ponto público (para checagem e exibição)
  ciphertext BLOB NOT NULL, iv BLOB NOT NULL, tag BLOB NOT NULL,
  created_at TEXT NOT NULL
);
```

---

## 4. Módulos internos

```ts
// config/
export interface ServiceConfig { network; deployment: Deployment; release: string | null; db: { path }; api: {...}; tuning: {...} }
export function loadConfig(env: NodeJS.ProcessEnv): ServiceConfig;          // ConfigInvalid (sem valores)

// keys/ — implementa a porta do SDK (S-11)
export class DbOperatorKeyStore implements OperatorKeyStore {
  constructor(repo: KeyRepo, master: Secret<Uint8Array>);
  spenderKey(): Promise<Secret<Scalar>>;
  envelopeKey(): Promise<Secret<Scalar>>;
  submitter(): Promise<Signer>;
  feeWallet(): Promise<{ signer: Signer; tokenKeys: Secret<TokenKeys> }>;   // só a CLI de bootstrap usa
}
export function sealKey(master, plaintext): Sealed;  export function openKey(master, sealed): Secret<Uint8Array>;  // AES-256-GCM, AAD = name

// chain/
export interface ChainDeps { chain: ChainClient; factory: FactoryPort; auction(a: ContractId): AuctionPort; token: TokenPort; prover: Prover }
export function connectChain(cfg: ServiceConfig, artifacts: ArtifactSet, recorder: TxRecorder): ChainDeps;
/** OP-18: Proxy do ChainClient que entrega o TxResult de toda transação a um TxSink. */
export function recordingChain(chain: ChainClient, sink: TxSink): ChainClient;

// markets/
export function discoverMarkets(d: { factory: FactoryPort; chain: ChainClient; auction; repo: MarketRepo; meta: MetaRepo; ledger: number }): Promise<{ added: bigint[] }>;
export function syncMarket(d: { auction: AuctionPort; token: TokenPort; repo: MarketRepo }, address: ContractId, ledger: number): Promise<void>;

// scheduler/ — puro
export function nextCheck(action: KeeperAction, ledger: number, ctx: { reconcile: number; backoffAttempts: number; backoffMax: number; failed: boolean }): number | null;
export function orderDue(markets: DueMarket[], ledger: number): DueMarket[];      // OP-17
export function deadlineAlert(m: { status; finalizeByLedger }, ledger: number, warn: number): AlertDraft | null;

// runner/
export class OperatorLoop {
  constructor(deps: { chain; keeper: Keeper; repos; alerts: AlertService; config; clock: Clock; logger });
  runOnce(): Promise<LoopReport>;              // um ledger: discovery? + ticks dos vencidos (testável)
  // O Keeper recebe um Clock que devolve o ledger lido no início da volta (1 chamada RPC por volta),
  // e o onEvent do Keeper alimenta um coletor por tick: é por ele que o laço sabe se a ação falhou (OP-15).
  run(signal: AbortSignal): Promise<void>;      // runOnce em laço, um por ledger
  pause(): void; resume(): void;
}
export class InstanceLease { acquire(holder: string): boolean; renew(): void; release(): void }   // OP-06

// alerts/
export type AlertKind = "FinalizeFailed" | "IntegrityMismatch" | "DeadlineNear" | "TimedOut" | "BidQuarantined"
  | "UnsupportedMarket" | "SubmitterLowBalance" | "RpcUnavailable" | "FeeWalletNotRegistered";
export class AlertService { fromKeeperEvent(e: KeeperEvent): void; raise(a: AlertDraft): void /* dedup */; }
```

---

## 5. CLI

`pnpm cli <comando>` (tsx). Nenhum comando imprime chave privada, exceto `keys export`, que exige `--i-understand` e escreve num arquivo com permissão 600.

| Comando | Efeito |
|---|---|
| `init-master [--out]` | cria a chave mestra (32 bytes, arquivo 600; não sobrescreve) |
| `api-key <read\|admin>` | gera uma API key e imprime o sha256 para o `.env` |
| `migrate` | aplica migrações |
| `keys generate <name>` | gera e guarda cifrada (`spender`, `submitter`, `fee_wallet_*`, `admin`) |
| `keys import <name> --from-file` | importa (a `envelope` **só** por import: tem de bater com o circuito, OP-10) |
| `keys import envelope --poc` | grava o escalar dos POCs (MVP de teste, OP-10) |
| `keys list` | nome + parte pública |
| `keys check` | as mesmas checagens do boot (§6.1 da arquitetura) |
| `bootstrap fee-wallet` | registra a fee wallet no Confidential Token (`AccountApi.ensureRegistered` do `client`; ADR-024 D22); sem efeito se já registrada |
| `bootstrap fund <submitter\|fee_wallet_stellar\|admin>` | friendbot (testnet/local; `CMI_FRIENDBOT_URL` muda a URL) |
| `bootstrap auditor-pubkey` | imprime `sk_op · H` (128 hex), a chave pública do auditor para o `--auditor-key` do deploy (D3, OP-20) |
| `markets rescan` / `markets show <id>` | discovery e leitura, sem a API |

---

## 6. Erros e alertas

| Código | Quando | Severidade do alerta |
|---|---|---|
| `ConfigInvalid` | boot | — (processo não sobe) |
| `MasterKeyInvalid` / `KeyNotFound` | boot | — |
| `EnvelopeKeyMismatch` | ponto da chave de envelope ≠ `BID_VALIDITY_PK_OPERATOR` | — (não sobe) |
| `LeaseHeld` | outra instância ativa | — (espera) |
| SDK `NetworkMismatch`, `ArtifactMismatch` | boot | — (não sobe) |
| SDK `UnsupportedContractsVersion` | discovery | `warning` (`UnsupportedMarket`) |
| SDK `RootMismatch`, `OpeningMismatch`, `CollateralMismatch` | finalize | `critical` (`IntegrityMismatch`) |
| SDK `ProofFailed`, `Auction.InvalidAllocationProof`, `Auction.TooLate` | finalize | `critical` (`FinalizeFailed`) |
| SDK `ResourceContention` | qualquer tx | nenhum (retry no próximo ledger) |
| keeper `quarantined` | settle repetidamente falhou | `critical` (`BidQuarantined`; a mensagem orienta a reiniciar o serviço, OP-19) |
| deadline | `finalize_by_ledger − L ≤ CMI_DEADLINE_WARN_LEDGERS` em `Closed` | `warning` → `critical` na metade |
| `cancel_expired` executado | timeout | `critical` (`TimedOut`) |
| saldo | submitter `< CMI_SUBMITTER_MIN_XLM` | `warning` |
| RPC | N falhas seguidas de `latestLedger` | `critical` (`RpcUnavailable`) |
| API | `Unauthorized` (401), `Forbidden` (403), `MarketNotFound` (404), `ValidationError` (400) | — |

---

## Mapa RF → módulo

| RF | Módulo do serviço | Do SDK |
|---|---|---|
| RF-01 | `api/routes/register-data`, `cli/bootstrap` | `registerDataForNextMarket`, `buildRegisterData` |
| RF-02 | `markets/discovery` | `FactoryPort.nextMarketId`, `getMarketAddress` |
| RF-16 | `runner` (via keeper) | ação `close` |
| RF-17, RF-18 | `runner` (via keeper), `alerts` | `readBids`, `planAllocation`, `proveAllocation` |
| RF-19 | `runner`, `scheduler/deadlineAlert` | ações `finalize`, `cancel_expired` |
| RF-20 | `runner` (via keeper) | `buildSettlement`, `settle`, `release_unsettled` |
| RF-21 | `runner`, `scheduler` (**dono da hospedagem: este repositório**) | `Keeper`, `planNextAction` |
| RF-22 | `markets/sync`, `api/routes/markets` | `AuctionPort` (consultas) |
