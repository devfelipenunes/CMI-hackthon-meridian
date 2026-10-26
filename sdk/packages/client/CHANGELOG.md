# Changelog — @zolvency-cmi/client

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). A versão do SDK é
fixada numa versão dos contratos do CMI Auctions (`SUPPORTED_CONTRACTS_TAGS`).

## [Não lançado]

### Adicionado
- `BrowserOpeningStore`: as aberturas da conta confidencial persistidas no IndexedDB, cifradas com uma `CryptoKey` não extraível e escopadas por rede, token e conta (S-22, fase 7.1).
- `AccountApi.sync({ fromLedger? })`: reconstrói as aberturas pelos eventos do token e só grava o que abre a conta on-chain (S-22, fase 7.2). Também `replayAccountEvents`, `SyncResult` e `SyncSource`.
- `AccountApi.exportBackup(password)` e `AccountApi.importBackup(text, password)`: backup da chave com as aberturas.

### Alterado
- `SellerApi.proceeds` devolve `Proceed[]`, com `received: bigint | null`: `null` é um vencedor liquidado cuja perna saiu da janela do RPC (S-23). Antes, ele sumia da lista, ou a chamada falhava. `bidder.status` não falha mais nesse caso (`refund: null`).
- `BrowserKeyProvider.exportBackup` aceita `{ openings }`, e `importBackup` devolve `{ account, tokenAddrF, openings }` (antes, `void`). O formato `cmi-key-backup:v1` não muda, e backups antigos continuam válidos.
- `register`, `deposit`, `merge`, o lock do `placeBid` e o `recoverCollateral` gravam o ledger da transação em `AccountOpenings.syncedLedger` (o checkpoint do `sync`).

## [0.1.0] — contratos `v0.1.0`

Primeira release. O que este pacote entrega está no README; a interface completa está em
[`docs/API.md`](https://github.com/zolvency-CMI/sdk/blob/main/docs/API.md) do repositório.
Validada pelos E2E de release dos contratos no quickstart: `rc.1` (lock e lance, 9/9), `rc.2`
(settlement, 8/8) e `rc.3` (leilão completo).
