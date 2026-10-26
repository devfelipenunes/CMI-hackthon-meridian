# CMI Auctions — Operador

O **operador** é o serviço que faz um leilão confidencial de cotas de RWA acontecer na Stellar/Soroban. Ele roda sozinho, o tempo todo, e é o único participante capaz de fechar, decidir e liquidar um mercado (ADR-024 D12).

Não é um front-end e não é uma carteira: é um **daemon Node/TypeScript** que observa a chain, decide o próximo passo de cada mercado e assina as transações.

```
      seller / bidders                        administrador
            │                                       │
            │  GET /v1/register-data                │  API key
            └──────────────────►┌──────────────┐◄───┘
                                │   operator   │
                                │ Fastify+API  │
                                │ discovery    │
                                │ agenda       │
                                │ executor     │
                                │ keystore     │
                                └──────┬───────┘
                                       │ assina como submitter
                    ───────────────────▼───────────────────
                    Stellar RPC · Factory · Auction · Token
```

---

## O que o serviço faz

| O serviço faz | Por quê |
|---|---|
| **Descobre** cada mercado novo varrendo a Factory, sem ninguém avisar | Um mercado pode ser criado por qualquer seller, a qualquer momento (RF-02) |
| **Acompanha** cada mercado pelo ledger da rede | As janelas do leilão são contadas em ledgers, não em horas (RF-21) |
| **Fecha** o mercado no `close_ledger` | Depois disso não entra lance (RF-16) |
| **Decide os vencedores**: decifra os envelopes, confere as provas, calcula a alocação e prova o resultado | Só o operador tem `sk_op` para abrir os lances (RF-17..RF-19) |
| **Paga**: liquida cada lance — vendedor, taxa, reembolso, cotas — um por ledger | O settlement é pesado e tem limite de um por ledger (RF-20, ADR-026) |
| **Encerra o que não dá para liquidar** e **cancela por timeout** | Um leilão travado precisa terminar, não ficar pendurado (RF-19, RF-20) |
| **Guarda as chaves** do operador cifradas | O serviço precisa delas em memória para assinar (ADR-024 D5) |
| **Expõe uma API** para observar e operar | Estado, mercados, ações, alertas e o `register_data` que o seller usa |

O protocolo — criptografia, provas, encoding, ordem das chamadas, regra do keeper — **não mora aqui**. Ele vem do SDK (`@zolvency-cmi/operator`). Este repositório hospeda o processo: agendamento, persistência, chaves e alertas (S-12 do SDK).

---

## A ideia central

Três princípios explicam quase todo o desenho:

1. **A chain é a verdade.** O banco é índice, agenda e trilha de auditoria. Toda decisão é tomada sobre o estado relido da chain; se banco e chain divergem, vence a chain (OP-05).
2. **Tempo é ledger, não relógio.** `close_ledger` e `finalize_by_ledger` são conhecidos desde a criação do mercado e não mudam. O serviço acorda a cada ledger e só age nos mercados cuja hora chegou (OP-04).
3. **O operador não publica preço.** Ele conhece todos os preços — é ele quem os decifra — mas nenhuma rota, log ou alerta os devolve, nem para o administrador (OP-16).

O resto decorre disso: por que não usar cron, por que o settlement é um por ledger, por que a descoberta não usa eventos. Cada escolha está registrada em [docs/DECISIONS.md](docs/DECISIONS.md).

---

## Como rodar

O operador consome o **SDK** e o deployment por caminhos irmãos:

```
cmi/
├── operator/   ← este projeto
├── sdk/        protocolo em TypeScript
├── specs/      produto, RFs e ADRs
└── contracts/  interface on-chain e artefatos
```

```bash
./scripts/setup-sdk.sh    # submódulos, build e teste do SDK, depois install aqui
cp .env.example .env      # ajuste CMI_NETWORK e as API keys
pnpm cli init-master      # data/master.key — guarde separado do banco
pnpm start                # sobe API + laço do keeper
```

Swagger UI em `http://127.0.0.1:8080/docs` (header `x-api-key`).

A sequência completa — chaves, deploy da plataforma, fee wallet, primeira subida — está em [docs/RUNBOOK.md](docs/RUNBOOK.md) §1.

```bash
pnpm lint       # eslint + dependency-cruiser + typecheck
pnpm test       # unit + integração + api
pnpm test:e2e   # rede local (exige Docker) ou testnet
```

---

## O que ele precisa para subir

| Peça | De onde vem |
|---|---|
| **Deployment** | `deployments/<rede>.json` — RPC, passphrase, endereços da Factory, do token e do auditor |
| **Chave mestra** | arquivo com permissão 600 (ou variável de ambiente); cifra a tabela `keys` |
| **Chaves do operador** | `spender` (`sk_op`), `envelope`, `submitter`, `fee_wallet_*`; geradas/importadas pela CLI |
| **API keys** | `read` e `admin`, guardadas como sha256 no ambiente |

Antes de operar, o boot confere rede, artefatos (sha256), chaves e fee wallet. Se algo estiver errado, o processo **não sobe** — e não imprime valor secreto (OP-13).

O deployment da testnet já está em [`deployments/testnet.json`](deployments/testnet.json): oito contratos implantados, com o hash de cada WASM e as VKs dos circuitos.

---

## Estado atual

| Área | Situação |
|---|---|
| Config, logger, banco, keystore, CLI | Implementado |
| Descoberta, sync, agenda, laço por ledger, lease | Implementado |
| Fechar, finalizar, liquidar, timeout, alertas | Implementado |
| API HTTP (status, mercados, ações, alertas, operação, `register_data`) | Implementado |
| E2E de um leilão completo | Escrito; roda contra rede local (Docker) ou testnet |

Limitações conscientes do MVP, não bugs:

- A chave de envelope é a dos POCs — qualquer um pode ler os envelopes on-chain (OP-10).
- Um bid em quarentena só volta a ser tentado após reiniciar o serviço (OP-19).
- Chaves no banco, sem HSM (ADR-024 D5).
- Operador fora do ar = leilões parados (ADR-024 D12).

---

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Como o serviço é dividido, como agenda por ledger, fluxo de um mercado, concorrência e segurança |
| [docs/API.md](docs/API.md) | Contrato externo e interno: rotas, configuração, schema do banco, módulos, CLI e erros |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Por que cada escolha foi feita (OP-01..OP-22), com alternativas recusadas |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | Operação: primeira subida, rede local, alertas, backup, atualização |
| [docs/requests/](docs/requests/) | Pedidos deste repositório para os contratos e para o SDK |

## Fontes da verdade

`specs/` (produto, RFs, ADRs), `sdk/` (protocolo em TypeScript) e `contracts/` (interface on-chain) mandam. Quando `docs/` contradiz qualquer um deles, vale o outro — e `docs/` é corrigido.

## Licença

MIT. Ver [LICENSE](LICENSE).
