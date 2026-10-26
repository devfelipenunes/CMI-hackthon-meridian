# CMI Auctions — Web app

> **Monorepo.** Este projeto vive em `web/` no monorepo CMI Auctions. O setup canônico é o [README da raiz](../README.md); as instruções de submódulo/SSH abaixo descrevem o repositório standalone original.

Front-end web do **CMI Auctions**: leilão confidencial de cotas de RWA na Stellar/Soroban, multi-unidade, *pay-as-bid* e de lance selado. Só o operador da plataforma vê os preços; tudo o que é cifrado e provado (ZK) é feito pelo **SDK** (`sdk`, submódulo). Não há back-end: o app fala com a testnet pelo SDK, e a carteira do usuário assina.

- **Planejamento, arquitetura, telas, testes e roadmap:** [`docs/`](docs/README.md). Comece por lá.
- **Quem vai desenvolver:** leia [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) e a skill [`.claude/skills/cmi-front-tdd`](.claude/skills/cmi-front-tdd/SKILL.md).
- **Status:** [`docs/ROADMAP.md`](docs/ROADMAP.md) é a única fonte. Hoje (2026-10-20): blocos 0–5 implementados no branch `fase/2-app`; scripts da testnet verificados ao vivo; `pnpm verify` e `pnpm e2e` (parte pública) verdes. Falta o leilão completo com o operador externo/Freighter.

---

## Setup

### 1. Ferramentas

| Ferramenta | Versão | Para quê |
|---|---|---|
| Node | 22 (`.node-version`) | tudo |
| pnpm | 10.34.6, pelo corepack (`corepack enable`) | workspace com o SDK |
| git + **SSH no GitHub** | — | os submódulos são privados |
| Chromium do Playwright | 1.55.1 (`pnpm exec playwright install chromium`) | testes de navegador e E2E |
| Freighter (extensão) | atual | carteira, na rede **Testnet** |

Não precisa de Docker nem de Rust: o front usa a testnet e o deploy que já existe.

### 2. Clonar com os submódulos

Os repositórios `sdk`, `contracts` e `specs` são **privados**, e as URLs nos `.gitmodules` são HTTPS. Com SSH configurado no GitHub:

```bash
git clone git@github.com:zolvency-CMI/web.git && cd web

# submódulos do front (sdk, specs), por SSH
git -c url."git@github.com:".insteadOf="https://github.com/" submodule update --init

# submódulos do SDK (contracts, specs, stellar-confidential-token-demo)
git -C sdk -c url."git@github.com:".insteadOf="https://github.com/" submodule update --init
```

> **Não use `--recursive`.** O `specs` tem um gitlink sem URL (`projetos/rs-soroban-ultrahonk`), e o `git submodule update --recursive` falha. Os dois comandos acima trazem tudo o que o front e o SDK usam.

Para não repetir o `-c`, configure uma vez: `git config --global url."git@github.com:".insteadOf "https://github.com/"`.

### 3. Conferir o SDK

```bash
cd sdk && pnpm install && pnpm test && cd ..    # ~665 testes, ~10 s
```

Se o SDK não passa aqui, o front não vai passar: resolva antes (versão do Node, submódulos).

### 4. Configuração local (`.env.local`)

```bash
cp .env.example .env.local
```

- `CMI_OPERATOR_SPENDER_KEY` / `CMI_REGISTER_DATA`: a chave de desenvolvimento do operador, ou o `register_data` que ele exporta (F-03). Vazio na primeira vez: o `pnpm register-data` (passo 1.2) gera uma chave de desenvolvimento e a grava aqui. **Nunca vai para o git nem para o app.**
- `VITE_DEV_WALLET=1`: liga a carteira de desenvolvimento (F-05). Só para testes; nunca no build público.

O `.env.local` e a pasta `.local/` estão no `.gitignore`.

### 5. Testnet

- **Deploy da plataforma:** já existe (contratos `v0.1.0-rc.4`). Os endereços estão em `sdk/contracts` na `main` (`deployments/testnet.json`); o `pnpm sync:deployment` (passo 1.1) os copia para `app/public/config/testnet.json`.
- **Contas:** friendbot (`https://friendbot.stellar.org?addr=G…`), 10.000 XLM por conta.
- **Freighter:** Settings → Network → **Testnet**.
- **Janela da RPC:** a RPC pública guarda ~7 dias de eventos (F-06, S-22, S-23).
- **Operador:** é outro sistema (F-04). Sem ele rodando, os leilões param em `Closed` e, ~10 min depois (carência de 120 ledgers do deploy de teste), podem ser cancelados por timeout.

### 6. Comandos

```bash
pnpm install          # inclui o build do @ctd/sdk do submódulo
pnpm dev              # o app (Vite)
pnpm lint             # eslint + dependency-cruiser + typecheck
pnpm test             # unit + flows + scripts (82 testes)
pnpm verify           # lint + test + build + bundle test
pnpm test:browser     # Chromium (prova e IndexedDB)
pnpm sync:deployment  # 1.1 · endereços da testnet → app/public/config/testnet.json
pnpm register-data    # 1.2 · register_data do operador → config
pnpm fund             # cria/financia carteiras dev (.local/dev-wallets.json)
pnpm token:issue      # 1.3 · token de cotas de teste, sem clawback
pnpm e2e              # Playwright; parte pública hoje, leilão completo com operador
```

**Carteira dev.** O botão aparece só em build de teste: `VITE_DEV_WALLET=1 pnpm build` (ou `VITE_DEV_WALLET=1 pnpm dev`). A chave secreta é digitada na tela e vive apenas na memória da aba; nenhuma chave vai para o bundle.

**Config.** `app/public/config/testnet.json` já está preenchido e conferido contra a testnet (factory, token, auditor, hash do wasm da Auction, VKs, `registerData` e `operatorKeyId`). Para regerar: `pnpm sync:deployment && pnpm register-data`; o `register-data` simula um `create_market` antes de gravar.

---

## Fluxo de branches

```text
main ◄── PR ── preparacao/dev     (planejamento e preparação; antes do código)
main ◄── PR ── fase/2-app         (o desenvolvimento, passo 0.1 a 7.3; commits teste → implementação)
```

O SDK tem o próprio fluxo (`fase/<n>-<nome>` → PR para a `main` do SDK). Uma mudança no SDK é feita **lá** (skill `cmi-sdk-tdd`), e depois o ponteiro do submódulo é atualizado aqui.
