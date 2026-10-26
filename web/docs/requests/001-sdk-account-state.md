# Pedido 001 — Estado da conta confidencial no navegador (SDK)

**De:** web · **Para:** sdk · **Data:** 2026-10-20 · **Decisões:** F-08 e F-14 do front; S-10, S-20 e **S-22** do SDK.

**Status (2026-10-20):** SDK-A e SDK-B na `main` do SDK (passos 7.1 e 7.2, merge `a72c9a4`, PR #10). O passo 7.3 (janela de eventos do RPC em todo leitor, S-23), achado na revisão do planejamento, também está na `main` do SDK (`0693e1f`, PR #11). SDK-C fora do MVP. **Pedido atendido.**

**API resultante** (detalhe no `docs/API.md` do SDK):
- `new BrowserOpeningStore({ network })` → `connectClient({ ..., openings })`;
- `client.account.sync({ fromLedger? })` → `{ source: "stored" | "checkpoint" | "events", events, syncedLedger }`;
- `client.account.exportBackup(senha)` / `client.account.importBackup(texto, senha)`.

**Achado no caminho (corrigido no SDK, mesmo passo):** o `ChainClient.events` parava na primeira página curta do `getEvents`, mas o RPC da testnet varre ~10.000 ledgers por chamada e devolve páginas vazias com cursor. Consultas que começam mais de ~14 h atrás voltavam vazias, inclusive `bidder.status`, `seller.proceeds` e `markets.watch`, que o front usa. Corrigido e validado na testnet.

## Problema

O `client` mantém as aberturas `(v, r)` do saldo confidencial num `OpeningStore`, mas só existe o `MemoryOpeningStore` (S-20: "persistência no navegador é um passo seguinte"). No front:
- um F5 apaga as aberturas, e toda operação seguinte falha com `BalanceOutOfSync`;
- em outro navegador, mesmo com o backup da chave importado, não há como recuperá-las pelo SDK.

O saldo não se perde (está na chain, e a `sk` basta), mas fica inutilizável no app. Isso bloqueia o MVP do front.

## Pedido

### SDK-A — `BrowserOpeningStore` (bloqueante)

- `implements OpeningStore`, no `@zolvency-cmi/client`, no molde do `BrowserKeyProvider`: IndexedDB, AES-GCM com uma `CryptoKey` não extraível, escopo `(rede, token, conta)` como additional data, `indexedDB` injetável em teste.
- Testes no molde do 2.7: `survives reload` (browser), `stored record is ciphertext`, `scoped record does not open in another scope`, `assertNoSecretLeak`.

### SDK-B — `account.sync({ fromLedger? })` (bloqueante)

Reconstrói as aberturas pelos eventos do token e confere o resultado contra os commitments on-chain (`BalanceOutOfSync` se não fechar). As regras usam funções que já existem no `core`:

| Evento (dono = eu) | Regra | Função existente |
|---|---|---|
| `deposit` | receiving += (valor, 0) | `addOpenings` |
| `spender_transfer` / transfer para mim | receiving += `decryptIncomingTransfer` | `decryptIncomingTransfer` |
| `merge` | spendable += receiving; receiving = 0 | `addOpenings` |
| `set_spender`, `revoke_spender` (e `withdraw`/transfer saindo) | spendable = `openSpendableBalance(b̃, σ)` | `openSpendableBalance` |

- `fromLedger` padrão: o `syncedLedger` guardado, ou o ledger do `register` da conta.
- **Backup com estado:** `exportBackup` passa a levar também as aberturas e o `syncedLedger` (cifrados pela mesma senha). O `importBackup` as restaura, e o `sync` continua dali. Assim, trocar de navegador não depende da janela de ~7 dias da RPC.
- **A confirmar:** que os eventos de `set_spender`/`revoke_spender` publicam `b̃` e `σ` (o payload os carrega). Senão, ler dos argumentos da transação.
- Referência: o `StateEngine` do `@ctd/sdk` (`state/engine.ts`) faz o mesmo para os eventos clássicos do token, mas não conhece os de spender.
- Testes: tabela por evento com o `FakeToken`; `sync from register reproduces stored openings`; `sync after a missed transfer fixes BalanceOutOfSync`; `window exceeded raises BalanceOutOfSync with a typed reason`; integração na rede local (deposit → merge → set_spender → settle → sync num store vazio == store do fluxo).

### SDK-C — `account.withdraw(amount)` (fora do MVP, decidido em 2026-10-20)

Usa o circuito `withdraw` (já nos artefatos) para devolver XLM do saldo confidencial ao saldo público. Fica para depois do MVP: os recebimentos ficam no saldo confidencial.

## O que o front faz enquanto isso

Desenvolve as telas com os fakes do SDK. A integração na testnet dos passos 2.4 em diante espera o SDK-A e o SDK-B.
