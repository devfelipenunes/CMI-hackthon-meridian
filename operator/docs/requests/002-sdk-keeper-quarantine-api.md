# Pedido 002 — Controle da quarentena e informações do keeper

**Para:** `sdk` · **De:** operator · **Decisões locais:** OP-15, OP-18, OP-19 · **Status:** não enviado — melhoria futura. A limitação foi aceita no MVP (OP-19): o caminho é reiniciar o serviço

## Contexto

O `Keeper` (passo 5.5 do SDK) guarda a quarentena de bids em memória no `KeeperScheduler`, que é privado. Hoje, o único jeito de tentar de novo um bid em quarentena é reiniciar o processo, o que também zera a quarentena de todos os outros bids.

## Pedido

1. **Quarentena:** `Keeper.release(auction, bidIndex)` (tira um bid da quarentena) e `Keeper.quarantined(): { auction; bidIndex; attempts }[]` (leitura). Opcional: aceitar um estado inicial no construtor, para o back-end persistir a quarentena.
2. **Falhas de ação de mercado:** hoje um `finalize` que falha volta no tick seguinte, sem backoff. O back-end resolve com a própria agenda (OP-15), então o pedido é só documentar esse comportamento na API do SDK.
3. **Opcional:** o `KeeperEvent` `action`/`settled` trazer o `TxResult` (hash, fee, CPU). O back-end já resolve decorando o `AuctionPort` (OP-18); se o SDK expuser isso, o decorador sai.

## Impacto aqui

Se o item 1 existir, entra a rota `POST /v1/markets/{id}/bids/{i}/retry`. Até lá, não há rota: o alerta `BidQuarantined` orienta a reiniciar o serviço.
