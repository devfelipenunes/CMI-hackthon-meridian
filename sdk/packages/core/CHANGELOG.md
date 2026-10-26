# Changelog — @zolvency-cmi/core

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). A versão do SDK é
fixada numa versão dos contratos do CMI Auctions (`SUPPORTED_CONTRACTS_TAGS`).

## [Não lançado]

### Adicionado
- `TokenPort.accountEvents({ account, startLedger })`, `TokenAccountEvent`, `AccountEventsPage` e `EVENT_WINDOW_MARGIN_LEDGERS`: os eventos do token que mudam as aberturas de uma conta, já no efeito de cada um, com o início ajustado à janela do RPC (S-22).
- `ChainClient.oldestEventLedger()`: o piso de retenção de eventos do RPC (`getHealth`).
- `ChainClient.eventStart(startLedger)`: o início que o RPC aceita (S-23).

### Alterado
- `ChainClient.events` divide mais de 5 padrões de tópico em vários filtros do mesmo pedido (limite do RPC).
- `RpcServer` ganhou `getHealth?()` (opcional).

### Corrigido
- `ChainClient.events` com um `startLedger` mais antigo que a janela de retenção do RPC era recusado pelo RPC; agora começa no piso da janela (S-23). Vale para `spenderTransfers`, os eventos da Auction e o `markets.watch`.
- `ChainClient.events` parava na primeira página curta. Mas o RPC varre no máximo ~10.000 ledgers por chamada e devolve uma página vazia com o cursor de onde parou, então consultas que começavam mais de ~10.000 ledgers atrás voltavam vazias ou incompletas (`spenderTransfers`, eventos da Auction, `markets.watch`). Agora a paginação segue até o cursor alcançar o último ledger.

## [0.1.0] — contratos `v0.1.0`

Primeira release. O que este pacote entrega está no README; a interface completa está em
[`docs/API.md`](https://github.com/zolvency-CMI/sdk/blob/main/docs/API.md) do repositório.
Validada pelos E2E de release dos contratos no quickstart: `rc.1` (lock e lance, 9/9), `rc.2`
(settlement, 8/8) e `rc.3` (leilão completo).
