# Runbook — operação do back-end do operador

Como subir, operar e recuperar o serviço. Comandos a partir da raiz do repositório; a CLI é `pnpm cli` (docs/API.md §5).

---

## 1. Primeira subida (OP-21)

```bash
./scripts/setup-sdk.sh                 # submódulos + SDK (GIT_SSH=1 se o HTTPS não tiver credencial)
cp .env.example .env                   # ajuste CMI_NETWORK e o resto

pnpm cli init-master                   # data/master.key (600). BACKUP SEPARADO do banco
pnpm cli api-key read                  # copie o sha256 para CMI_API_KEY_READ_SHA256; guarde a chave
pnpm cli api-key admin                 # idem para CMI_API_KEY_ADMIN_SHA256

pnpm cli keys generate spender         # sk_op (spender de toda Auction + auditor, D3/D5)
pnpm cli keys generate submitter       # conta que envia as tx do keeper
pnpm cli keys generate fee_wallet_stellar
pnpm cli keys generate fee_wallet_token
pnpm cli keys import envelope --poc    # MVP de teste: chave pública dos POCs (OP-10)
pnpm cli keys list

pnpm cli bootstrap auditor-pubkey      # → --auditor-key do deploy
```

**Deploy da plataforma** (repositório de contratos, `sdk/contracts`):

```bash
./scripts/deploy-testnet.sh --network testnet --identity <admin> \
  --auditor-key <saída do auditor-pubkey> --fee-wallet <endereço do fee_wallet_stellar> \
  --finalization-grace 34560           # produção: 2 dias. Testes: curto (ADR-027)
cp deployments/testnet.json <este repo>/deployments/testnet.json
```

**Depois do deploy:**

```bash
pnpm cli bootstrap fund submitter            # friendbot (testnet/local)
pnpm cli bootstrap fund fee_wallet_stellar
pnpm cli bootstrap fee-wallet                # registra a fee wallet no token: sem isso, nenhum mercado (D22)
pnpm cli keys check                          # as checagens do boot, sem subir o serviço
pnpm start
```

Swagger UI: `http://127.0.0.1:8080/docs` (header `x-api-key`).

---

## 2. Rede local (desenvolvimento e E2E)

A rede local é o `stellar/quickstart`, que roda em Docker; o operador em si não usa container. O Docker precisa estar acessível pelo seu usuário (`sudo usermod -aG docker $USER` e um novo login).

```bash
./scripts/localnet.sh up      # quickstart + deploy com carência de 60 ledgers → deployments/local.json
pnpm test:e2e                 # o serviço de verdade contra a rede local
./scripts/localnet.sh down
```

Na rede local, a fee wallet do deploy é a identidade admin do `stellar-cli`, já registrada pelo `deploy-local.sh`.

### 2.1 E2E na testnet

O mesmo teste da rede local, contra a testnet pública. Não precisa de Docker, mas cria contratos públicos e leva ~1 h por rodada (5 s por ledger, lances em série com provas).

1. As chaves do operador e a identidade admin do deploy (§1): `init-master`, `keys generate …`, `keys import envelope --poc` e `stellar keys generate <admin> --network testnet --fund`.
2. O deploy com **carência curta** (ADR-027: 12..34560). 120 ledgers ≈ 10 min, e o teste de timeout só roda com carência ≤ 720:
   ```bash
   cd sdk/contracts
   ./scripts/deploy-testnet.sh --network testnet --identity <admin> \
     --auditor-key "$(cd ../.. && pnpm -s cli bootstrap auditor-pubkey)" \
     --fee-wallet "$(cd ../.. && pnpm -s cli keys list | grep fee_wallet_stellar | awk '{print $2}')" \
     --finalization-grace 120
   cp deployments/testnet.json ../../deployments/testnet.json
   ```
   Se `deployments/testnet.json` já existir no repositório de contratos, o script só confere o deploy existente. Para um deploy novo, apague ou renomeie o arquivo antes.
3. A fee wallet no token, sem a qual nenhum mercado é criado (D22):
   ```bash
   CMI_NETWORK=testnet pnpm cli bootstrap fund fee_wallet_stellar
   CMI_NETWORK=testnet pnpm cli bootstrap fee-wallet
   CMI_NETWORK=testnet pnpm cli keys check
   ```
4. O teste: `CMI_E2E_NETWORK=testnet pnpm test:e2e`. Ele usa um banco temporário com spender e submitter novos (financiados pelo friendbot), e seller e bidders descartáveis.

Um deploy com carência curta é **só de teste**. O deploy de uso real é o do §1, com 34560.

---

## 3. O dia a dia

| Para quê | Como |
|---|---|
| Estado geral | `GET /v1/status` (ledger, laço, lease, saldo do submitter, contagem por estado, alertas abertos) |
| Um mercado | `GET /v1/markets/{id}` e `GET /v1/markets/{id}/actions` (hash, fee e CPU de cada tx) |
| Alertas | `GET /v1/alerts?open=true`; `POST /v1/alerts/{id}/ack` |
| Pausar envios | `POST /v1/keeper/pause` (continua lendo); `POST /v1/keeper/resume` |
| Forçar varredura | `POST /v1/discovery/rescan` |
| Olhar um mercado já | `POST /v1/markets/{id}/resync` |

O serviço **não tem rota para executar uma ação específica**: quem decide é o `planNextAction` do SDK sobre a chain.

---

## 4. Alertas e o que fazer

| Alerta | Severidade | O que fazer |
|---|---|---|
| `IntegrityMismatch` | crítico | Um envelope não abre o commitment, a raiz diverge ou o colateral não bate (RF-17). **Não se resolve sozinho.** Investigar antes do `finalize_by_ledger`; se não houver correção, o mercado cancela por timeout e todos são reembolsados |
| `FinalizeFailed` | crítico | O serviço tenta de novo com backoff até o prazo. Verificar RPC, saldo do submitter, artefatos |
| `DeadlineNear` | aviso → crítico | Mercado `Closed` perto do prazo sem finalizar. Ver o `FinalizeFailed` correspondente |
| `TimedOut` | crítico | O mercado foi cancelado por timeout; os reembolsos seguem sozinhos |
| `BidQuarantined` | crítico | Um settle falhou 3 vezes. **Reinicie o serviço** para tentar de novo (OP-19, limitação aceita). O bidder tem colateral travado até `finalize_by + 1 dia` |
| `RpcUnavailable` | crítico | O RPC falhou 3 voltas seguidas. Nada se perde: ao voltar, o serviço continua da chain |
| `SubmitterLowBalance` | aviso | Fundear o submitter. Cada transição devolve 0,5 XLM da reserva do seller (D-04), mas o saldo inicial é do operador |
| `FeeWalletNotRegistered` | aviso | `pnpm cli bootstrap fee-wallet` |
| `UnsupportedMarket` | aviso | O mercado usa uma Auction que este SDK não conhece. Atualizar o submódulo do SDK |
| `PocEnvelopeKey` | info | Lembrete: a chave de envelope é a dos POCs; só para teste (OP-10) |

---

## 5. Backup e recuperação

- **O que guardar:** o arquivo SQLite (`CMI_DB_PATH`, com as chaves cifradas) e, **em outro lugar**, a chave mestra.
- **Perder o banco, mas ter as chaves:** reimportar as chaves (`keys import`) num banco novo. Os mercados voltam sozinhos: a descoberta relê a Factory desde o id 1 (OP-05).
- **Perder `sk_op`:** nenhum mercado aberto pode ser liquidado. Os bidders só saem com `revoke_spender` (OQ-15). Não há recuperação.
- **Reinício:** sempre seguro. O serviço relê a chain, nada é enviado duas vezes (`settle` é idempotente).
- **Duas instâncias:** o lease (OP-06) impede a segunda de enviar. Com o banco em volume local, rode uma só.

## 6. Atualizar o SDK ou os contratos

1. Avançar o submódulo `sdk` num PR próprio; `./scripts/setup-sdk.sh`; `pnpm lint && pnpm test && pnpm test:proving`.
2. Mercados antigos continuam com a versão deles (ADR-022): o SDK escolhe os artefatos pelo hash do WASM (S-18). Um mercado de versão desconhecida gera `UnsupportedMarket`.
3. Release dos contratos: `sdk/scripts/fetch-artifacts.sh <tag>` e `CMI_CONTRACTS_RELEASE=<tag>`.

## 7. Limites conhecidos do MVP

- Chave de envelope pública (OP-10): só teste.
- Quarentena só sai com reinício (OP-19).
- Chaves no banco, sem HSM (ADR-024 D5).
- Operador fora do ar = leilões parados; bidders saem com `revoke_spender` (OQ-15).
- SDK fora do npm: consumido do submódulo (OP-02).
