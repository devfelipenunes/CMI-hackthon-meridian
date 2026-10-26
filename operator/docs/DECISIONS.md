# Decisões do back-end do operador

Decisões tomadas neste repositório. Elas usam o prefixo **OP-** para não se confundir com:
- **D1–D22**: ADR-024, no `specs`;
- **D-01..**: decisões do `contracts`;
- **S-01..**: decisões do `sdk`.

| Status | Significado |
|---|---|
| **ADOTADA** | vale; mudar exige uma nova entrada aqui |
| **VERIFICAR (passo x.y)** | decidida, mas depende de uma checagem técnica no passo indicado |
| **ABERTA** | precisa de decisão de produto ou de outro repositório antes do passo indicado |

| # | Tema | Status |
|---|---|---|
| OP-01 | Node 22 + TypeScript estrito + ESM + pnpm + Vitest | ADOTADA (2026-10-20) |
| OP-02 | SDK consumido do submódulo por `link:` até o `0.1.0` no npm | ADOTADA; verificado com `tsx` |
| OP-03 | Descoberta de mercados pelo contador da Factory, não por eventos | ADOTADA |
| OP-04 | Agendamento por ledger: laço a cada ledger + `next_check_ledger` por mercado | ADOTADA |
| OP-05 | A chain é a fonte da verdade; o banco é índice, agenda e auditoria | ADOTADA |
| OP-06 | Uma instância ativa por rede (lease) | ADOTADA |
| OP-07 | SQLite (`better-sqlite3`) com migrações SQL | ADOTADA |
| OP-08 | Keystore no banco, AES-256-GCM sob chave mestra externa | ADOTADA |
| OP-09 | API Fastify + TypeBox + OpenAPI/Swagger, API keys `read`/`admin` | ADOTADA |
| OP-10 | Chave de envelope: a chave dos POCs no MVP de teste | ADOTADA (2026-10-20); troca futura em `requests/001` |
| OP-11 | Logs pino com redação; trilha de auditoria no banco | ADOTADA |
| OP-12 | Alertas no banco + webhook opcional | ADOTADA |
| OP-13 | Checagens de boot que impedem subir | ADOTADA |
| OP-14 | Prover único, provas em série | ADOTADA |
| OP-15 | Backoff e alerta para falha de ação de mercado (finalize) | ADOTADA |
| OP-16 | A API nunca devolve preço nem valor, nem para admin | ADOTADA |
| OP-17 | Prioridade entre mercados vencidos no mesmo ledger | ADOTADA |
| OP-18 | `ChainClient` instrumentado (Proxy) para gravar hash/fee/CPU das transações | ADOTADA (revisada no 2.1) |
| OP-19 | Quarentena de bid só sai com reinício | ADOTADA (2026-10-20) — limitação aceita do MVP |
| OP-20 | Chaves de que o serviço precisa e quem as gera | ADOTADA; VERIFICAR (1.4) auditor |
| OP-21 | Ordem da primeira subida: chaves → deploy da plataforma → fee wallet → serviço | ADOTADA |
| OP-22 | Segundos por ledger por rede, só para exibição | ADOTADA |

---

## OP-01 — Stack · ADOTADA (2026-10-20)

**Decisão.** Node 22 (`.node-version` igual ao do SDK), TypeScript estrito com as mesmas flags do `tsconfig.base.json` do SDK (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), ESM, pnpm 10, Vitest 3, ESLint 9 + `dependency-cruiser`. Versões exatas, iguais às do SDK quando ambos usam.

**Por quê.** O pacote `@zolvency-cmi/operator` é só Node (S-02 do SDK), e o código-fonte do SDK é compilado junto: flags diferentes quebrariam o typecheck.

---

## OP-02 — SDK pelo submódulo · ADOTADA; VERIFICAR (0.1)

**Contexto.** O SDK ainda não está no npm (passo 6.5 de lá). Os `exports` dos pacotes apontam para `src/*.ts`, e o `core` importa o `@ctd/sdk`, que só existe no workspace do SDK.

**Decisão.**
- `sdk/` é submódulo deste repositório, fixado num commit.
- `scripts/setup-sdk.sh` inicializa os submódulos do SDK, roda `pnpm install`, `pnpm build` e `pnpm test:unit` lá dentro, e depois `pnpm install` aqui.
- Dependências: `"@zolvency-cmi/{artifacts,core,operator}": "link:../sdk/packages/…"` e, só em dev, `@zolvency-cmi/testing` (fakes). As dependências transitivas resolvem pelo `node_modules` do SDK.
- Execução com `tsx` (dev e, no MVP, produção).
- Quando o `0.1.0` sair no npm: trocar `link:` por versões exatas e build com `tsc`/esbuild.

**Verificar.** Que o serviço sobe com `node --import tsx` a partir de um clone limpo, e quanto tempo o boot leva (transpilação do SDK).

**Como atualizar o SDK.** Avançar o submódulo num PR próprio, rodar `setup-sdk.sh`, rodar a suíte inteira daqui.

---

## OP-03 — Descoberta pela Factory · ADOTADA

**Decisão.** A cada `CMI_DISCOVERY_EVERY_LEDGERS` (12 ≈ 1 min), o serviço lê `next_market_id` e registra todo id entre o cursor salvo e ele (`get_market_address`). O cursor só avança depois de gravar o mercado.

**Por quê.** É o único índice que nunca expira. Os eventos `MarketCreated` saem da janela do RPC em dias (S-23), e o serviço pode ficar parado mais que isso.

**Alternativa recusada.** Escutar `getEvents`: mais rápido, mas exige reconstrução quando a janela passa; o contador já é barato (2 leituras por mercado novo).

---

## OP-04 — Agendamento por ledger · ADOTADA

**Decisão.** Ver [ARCHITECTURE §2](ARCHITECTURE.md#2-como-o-serviço-sabe-que-um-mercado-vai-fechar-estratégia-de-agendamento). Laço a cada ledger, uma leitura de `latestLedger` por volta, `next_check_ledger` por mercado, reconciliação a cada `CMI_RECONCILE_LEDGERS`.

**Por quê.**
- `close_ledger` e `finalize_by_ledger` são conhecidos desde a criação;
- a carência conta do `close_ledger`: atraso no fechamento come a janela do `finalize`;
- o settlement exige ledgers seguidos (1 por ledger).

**Alternativas recusadas.** Cron diário (perde a janela em ambiente de teste e atrasa resultados); timers de parede (`setTimeout` até a data estimada: o ledger não tem duração fixa).

---

## OP-05 — Chain como fonte da verdade · ADOTADA

**Decisão.** Toda ação é decidida pelo `Keeper.tick` do SDK, que relê a chain. O banco nunca é usado para decidir *o que* fazer, só *quando* olhar. Se banco e chain divergem, vence a chain e o banco é corrigido no `sync`.

**Consequência.** Apagar o banco (menos a tabela `keys`) não perde nada: a discovery do id 1 em diante reconstrói tudo.

---

## OP-06 — Instância única · ADOTADA

**Decisão.** Lease na tabela `meta` (`holder`, `expires_at`), renovado a cada volta **e antes de cada transação**; validade de 5 min, maior que o pior tick (um `finalize` gera a prova e espera a confirmação da tx). Sem lease, o laço não envia transação (a API continua de pé, em modo leitura). Com SQLite num arquivo local, isso também impede dois processos na mesma máquina.

**Por quê.** Duas instâncias não são inseguras (idempotência e estado), mas duplicam taxas e quebram o limite de 1 `settle` por ledger do `KeeperScheduler`, que vive na memória de um processo.

---

## OP-07 — SQLite · ADOTADA

**Decisão.** `better-sqlite3` (síncrono, maduro), modo WAL, migrações SQL numeradas aplicadas no boot, repositórios atrás de interfaces (trocar por Postgres depois é trocar os repositórios).

**Alternativa.** `node:sqlite` (sem dependência nativa), ainda experimental no Node 22.

**Por quê.** O volume é minúsculo (≤ 8 bids por mercado) e o serviço é instância única (OP-06).

---

## OP-08 — Keystore · ADOTADA

**Contexto.** ADR-024 D5/D14/D19/D22: chaves no banco do back-end, separadas; HSM/TEE é pós-MVP.

**Decisão.**
- Cada chave é uma linha de `keys`, cifrada com AES-256-GCM, IV aleatório de 12 bytes, AAD = nome da chave.
- A chave mestra (32 bytes) vem de `CMI_MASTER_KEY_FILE` (arquivo 600, preferido) ou `CMI_MASTER_KEY`; nunca do banco.
- Em memória, só como `Secret<T>`; decifradas sob demanda pelo `DbOperatorKeyStore`.
- A interface é o `OperatorKeyStore` do SDK (S-11): trocar por HSM depois não muda o resto.

**Risco aceito (MVP).** Quem tem o arquivo e a chave mestra tem tudo. Backup dos dois separado.

---

## OP-09 — API · ADOTADA

**Decisão.** Fastify 5, schemas TypeBox (validação + tipos + OpenAPI 3.1), `@fastify/swagger` e `@fastify/swagger-ui` em `/docs` (com o esquema `apiKey` declarado, para testar pelo Swagger). Duas API keys (`read`, `admin`), guardadas como sha256 no ambiente, comparadas em tempo constante. Escuta em `127.0.0.1` por padrão; exposição externa via proxy reverso com TLS.

**Rotas públicas (sem chave):** `/health` e `/v1/register-data`. O `register_data` não é segredo (vai on-chain em todo `create_market`), e o front do seller roda no navegador: uma chave nele seria pública. CORS só para as origens de `CMI_CORS_ORIGINS`, e só nessa rota.

---

## OP-10 — Chave de envelope · ADOTADA (2026-10-20)

**Contexto.** O `PK_operator` é **constante do circuito** `bid_validity` (D-06 dos contratos). Na release atual (`v0.1.0-rc.4`) ele é `987654321098 · G`, o escalar **documentado nos POCs** (`BID_VALIDITY_PK_OPERATOR` no SDK).

**Consequência.** Qualquer pessoa pode decifrar todos os envelopes guardados no contrato e ler todos os preços. Isso quebra G1/G2 para o público, não só para o operador.

**Decisão (dono do projeto, 2026-10-20).** O MVP é de teste: **usa a chave dos POCs** (escalar `987654321098`) e a troca fica para o futuro.
- `keys import envelope --poc` grava o escalar dos POCs cifrado, como qualquer outra chave; o resto do serviço não sabe que ela é pública.
- O serviço continua **se recusando a subir** se o ponto da chave de envelope não for o `BID_VALIDITY_PK_OPERATOR` do circuito em uso (`EnvelopeKeyMismatch`). É essa checagem que torna a troca futura segura: quando o circuito mudar, o serviço só sobe com a chave nova.
- O `/v1/status` mostra `envelopeKey: "poc"` enquanto a chave for a dos POCs, para ninguém esquecer.
- **Risco aceito:** enquanto a chave for a dos POCs, qualquer pessoa pode ler os preços dos envelopes on-chain. Aceitável em teste; não vale para dinheiro real.
- **Troca futura:** [`requests/001`](requests/001-contracts-secret-envelope-key.md) (adiado), um circuito com um `PK_operator` cujo escalar só o operador conhece. Do lado deste serviço, a troca é: `keys generate envelope --for-circuit` (imprime só o ponto para os contratos) e, com a release nova, atualizar o submódulo do SDK.

---

## OP-11 — Logs e auditoria · ADOTADA

**Decisão.** pino (JSON), com redação de `*.secret`, `*Key`, `registerData`, `proof`, `witness`, `secrets`, e serializador que troca qualquer `Secret` por `"[redacted]"`. Cada ação do keeper e cada tx vão para `actions` (OP-18). Nenhum log em `debug` de `DecryptedBid` ou `AllocationPlan`.

---

## OP-12 — Alertas · ADOTADA

**Decisão.** `AlertService` com regras (API §6), deduplicação por `dedup_key` enquanto o alerta está aberto, `GET /v1/alerts`, ack por `admin`, e POST opcional num webhook (`CMI_ALERT_WEBHOOK_URL`). Métricas Prometheus ficam para a fase 6.

---

## OP-13 — Checagens de boot · ADOTADA

O processo **não sobe** se: config inválida; chave mestra errada; artefatos com sha256 diferente; RPC em outra rede; chave de envelope ≠ circuito (OP-10). **Sobe com alerta** se: submitter com saldo baixo; fee wallet não registrada (nenhum mercado novo pode ser criado, ADR-024 D22).

---

## OP-14 — Prover · ADOTADA

**Decisão.** Um `Prover` (`createProver`) por processo, criado no boot e destruído no shutdown. Um tick pesado por vez. Tempo de prova de cada ação é medido e gravado (para dimensionar a máquina).

---

## OP-15 — Falha de ação de mercado · ADOTADA

**Contexto.** O `Keeper` do SDK só põe em quarentena ações de **bid**. Um `finalize` que falha volta a ser tentado no tick seguinte, com uma prova nova a cada vez.

**Como o serviço sabe que falhou.** O `Keeper.tick` devolve a ação planejada mesmo quando ela falha; a falha só aparece no `KeeperEvent` `failed` emitido durante o tick. Como há um único `Keeper` e os ticks são em série, o laço coleta os eventos de cada tick (`onEvent`) e decide sobre eles.

**Decisão.** O serviço guarda `backoff_attempts` por mercado: próxima checagem em `L + 2^n` ledgers (teto `CMI_BACKOFF_MAX_LEDGERS`), alerta `FinalizeFailed`/`IntegrityMismatch` na primeira falha. O backoff nunca empurra a checagem para depois de `finalize_by_ledger − 1`.

**Por quê.** Um `IntegrityMismatch` não se resolve sozinho (um envelope que não abre o commitment é um alarme de protocolo, RF-17); repetir provas a cada 5 s só gasta CPU. Já uma falha de RPC se resolve, e o backoff curto dá conta.

---

## OP-16 — Privacidade da API · ADOTADA

**Decisão.** Nenhum campo de resposta, de nenhuma rota, carrega preço, preço de corte, colateral, valor pago, taxa ou reembolso. O banco também não guarda esses valores, e nenhuma rota pode passar a devolvê-los.

**Por quê.** O operador conhece os preços (ADR-024 D2), mas o serviço é a superfície mais exposta da plataforma; não publicá-los em lugar nenhum é a única forma de não vazá-los.

---

## OP-17 — Prioridade · ADOTADA

**Decisão.** Entre mercados vencidos no mesmo ledger: (1) `Closed` ordenados por `finalize_by_ledger` crescente; (2) `Open` com `close_ledger` vencido; (3) `Finalized`/`Cancelled` com bids pendentes, por `market_id`; (4) reconciliações.

---

## OP-18 — Transações registradas · ADOTADA

**Contexto.** O `KeeperEvent` não traz o hash da transação, a taxa nem a CPU, mas o `CmiOperator` recebe a fábrica `auction: (address) => AuctionPort`.

**Decisão (revisada no 2.1).** `recordingChain` é um Proxy do `ChainClient` real que entrega a um `TxSink` o `TxResult` de toda chamada `invoke`; o laço lê o sink a cada tick e grava hash, fee e CPU da transação da Auction na tabela `actions`. Sem mudar o SDK. A primeira ideia era decorar o `AuctionPort`, mas o `settle` da porta devolve só `Settled | AlreadySettled`, sem o `TxResult`.

---

## OP-19 — Quarentena só sai com reinício · ADOTADA (2026-10-20) — limitação aceita

**Contexto.** O keeper do SDK põe um bid em quarentena depois de 3 falhas seguidas de `settle`/`release_unsettled` (`ResourceContention` não conta), para um bid problemático não travar os outros. A quarentena vive na memória do `KeeperScheduler`, e o SDK não expõe como tirar um bid de lá.

**Decisão (dono do projeto).** Limitação **aceita** no MVP:
- não há rota de API para tentar de novo um bid em quarentena;
- o caminho é **reiniciar o serviço**, o que zera a quarentena de todos os bids (seguro: o keeper relê a chain e `settle` é idempotente);
- o alerta `BidQuarantined` diz isso na mensagem;
- [`requests/002`](requests/002-sdk-keeper-quarantine-api.md) fica como melhoria futura, não enviada.

**Por que é aceitável.** É raro (exige 3 falhas reais seguidas no mesmo bid), não afeta outros bids nem outros mercados, e a delegação do bidder vale até `finalize_by_ledger + 1 dia` (D-05), tempo de sobra para um reinício.

---

## OP-20 — Chaves · ADOTADA; VERIFICAR (1.4)

| Nome | O que é | Origem | Usada por |
|---|---|---|---|
| `spender` | `sk_op`: spender de todo Auction e chave do auditor (D3, D5) | `keys generate` | `register_data`, `readBids`, `buildSettlement` |
| `envelope` | escalar do `PK_operator` do circuito (D19) | `keys import` (OP-10) | `readBids` |
| `submitter` | conta Stellar que envia as tx do keeper e recebe os reembolsos de 0,5 XLM (D-04) | `keys generate` + fundear | keeper |
| `fee_wallet_stellar` + `fee_wallet_token` | conta e chaves confidenciais da carteira de taxas (D22) | `keys generate` | `bootstrap fee-wallet`; saque das taxas é fora do MVP |
| `admin` | carteira admin da Factory/token/verifiers (D14) | `keys import` | **não** usada pelo laço; só CLI de operação |

**Auditor.** A chave pública do auditor é `sk_op · H` (o formato do `auditorKeyHex` do SDK: 128 hex, `be(x) ‖ be(y)`), entregue ao deploy da plataforma (`--auditor-key`). Os fluxos do operador **não usam** o papel de auditor (o `readBids` lê o colateral como spender); ele só cumpre a D3.

**Verificar (1.4).** Que `TokenPort.auditorKey(auditor_id)` do deploy em uso é `sk_op · H`; se não for, o boot alerta (não impede: nenhum fluxo do serviço depende disso).

---

## OP-21 — Ordem da primeira subida · ADOTADA

**Contexto.** O deploy da plataforma (token, auditor, verifiers, Factory) é feito pelo `scripts/deploy-testnet.sh` dos contratos (no quickstart, pelo `deploy-local.sh` do SDK). Ele recebe a **chave pública do auditor** e o **endereço da fee wallet**, e grava a `PlatformConfig`. A fee wallet só pode ser registrada no token **depois** que o token existe.

**Decisão.** Ordem:
1. `keys generate spender`, `submitter`, `fee_wallet_*`; `keys import envelope --poc`;
2. `bootstrap auditor-pubkey` → chave pública do auditor; fundear submitter e fee wallet (friendbot na testnet);
3. deploy da plataforma (repositório de contratos) com `--auditor-key` e `--fee-wallet` do passo 1–2; copiar o `deployments/<rede>.json` para cá;
4. `bootstrap fee-wallet` (registra a fee wallet no token: `AccountApi.ensureRegistered` do `@zolvency-cmi/client` com as chaves confidenciais guardadas);
5. subir o serviço; o boot confere tudo (OP-13).

**Consequência.** O registro usa as primitivas do `core` (`buildRegisterWitness`, `encodeRegisterData`, `TokenPort.register`), sem o `client`, que fica só como dependência de desenvolvimento (E2E). Na rede local, o `deploy-local.sh` do SDK usa a identidade admin como fee wallet e um auditor descartável; o E2E local pode usar esse deploy, e o passo 5.3 faz o deploy da testnet com as chaves do operador.

---

## OP-22 — Segundos por ledger · ADOTADA

**Decisão.** `SECONDS_PER_LEDGER` vem do deployment da rede (5 na testnet, 1 no quickstart) e só serve para estimar datas na API (`estimatedCloseAt`). Nenhuma regra usa data.
