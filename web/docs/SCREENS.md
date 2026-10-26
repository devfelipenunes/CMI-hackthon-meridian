# Telas

Cada tela lista o que mostra, o que chama no SDK e os estados de erro. Os códigos de erro são os `CmiError.code` do SDK (API.md §6 do SDK), traduzidos em `src/domain/errors.ts`.

Convenções:
- **[carteira]** = a ação abre a carteira para assinar.
- Valores em XLM aparecem com 7 casas no máximo e entram no SDK como `bigint` em stroops. Cotas são inteiras (`1 cota = QUOTA_UNIT` unidades base no contrato; o SDK recebe a quantidade inteira).
- Tempos aparecem **só como duração** relativa ao ledger atual ("in 5 minutes", "5 days ago", contagem regressiva), **estimada** a partir do ledger (F-10), com o número do ledger ao lado ou num tooltip. **Nenhuma data de calendário** aparece no site.

---

## 0. Estrutura global

- **Cabeçalho:** logo, link "Leilões", seletor de modo (Empresa / Investidor) depois de conectar, botão da carteira (endereço curto, rede, saldo XLM público), selo "Testnet".
- **Banner de backup pendente** em toda tela enquanto `backupStatus().backupRequired` for `true`.
- **Toasts** de transação: assinando → enviando → confirmada (hash, ledger) / falhou (código traduzido).
- **Indicador de prova** (`ProofProgress`): "Gerando provas no navegador (~5–20 s)", com etapas.

---

## 1. Público

### 1.1 Início — lista de leilões (`/`)
- Cards/tabela: `marketId`, ativo (código + emissor do SAC), total de cotas, preço mínimo por cota, estado, contagem regressiva até o `closeLedger`, lances (`bidCount`/8), demanda pública (Σ quantidades).
- Filtros por estado (`Open`, `Closed`, `Finalized`, `Settled`, `Cancelled`, `Created`). Padrão: abertos primeiro.
- SDK: `client.markets.list({ status })` (sem carteira: `MarketsApi` sobre portas de leitura).
- Vazio: "Nenhum leilão ainda" + CTA "Criar leilão (Empresa)".

### 1.2 Detalhe do leilão (`/market/:id`)
- Cabeçalho: estado, ativo, total, piso, fechamento (tempo relativo estimado + ledger), prazo de finalização (`finalizeByLedger`), reserva de taxa restante (`getFeeReserve`).
- **Lances (públicos):** `bid_index`, carteira (curta), quantidade pedida, estado do settlement; **depois do `finalize`**, quantidade alocada. Nunca preço.
- **Barra de demanda** vs. total de cotas.
- **Linha do tempo:** eventos de `client.markets.watch(marketId, { fromLedger })` (MarketOpened, BidAccepted, MarketClosed, MarketFinalized, BidSettled, BidFailed, MarketSettled, MarketCancelled). A RPC da testnet guarda ~7 dias. O SDK começa a leitura no início da janela (S-23, passo 7.3); se a criação do mercado for mais antiga que `chain.oldestEventLedger()`, a linha do tempo mostra o aviso "eventos anteriores ao ledger <n> não estão mais disponíveis". O estado e a alocação continuam vindo da Auction.
- **Progresso do operador** (sistema externo, F-04): "Aguardando fechamento" → "Fechado; o operador tem até o ledger X (~em N minutos) para apurar" → "Apurado" → "Liquidando k de n lances" → "Concluído". Passado o prazo: "O operador não apurou a tempo; qualquer um pode cancelar e devolver tudo".
- **Ações contextuais:**
  - modo Investidor, `Open` e antes do fechamento → "Dar lance";
  - qualquer carteira, `Open` e `ledger ≥ closeLedger` → "Fechar leilão" (`auctionAt(addr).closeMarket(signer)`) [carteira];
  - qualquer carteira, `Closed` e `ledger > finalizeByLedger` → "Cancelar por timeout" (`cancelExpired`) [carteira];
  - dono, `Created` → "Abrir (travar cotas)" / "Cancelar"; dono, `Open` sem lances → "Cancelar".
- Aviso permanente: "Os preços são selados: ninguém além do operador da plataforma vê os lances."

---

## 2. Onboarding

### 2.1 Conectar carteira (`/connect`)
- Opções: Freighter (Stellar Wallets Kit) e, com `VITE_DEV_WALLET=1`, a **carteira de desenvolvimento** (F-05).
- Confere a rede da carteira contra a configuração (`NetworkMismatch` → instrução para trocar a Freighter para Testnet).
- Conta inexistente na testnet → botão "Financiar com friendbot".

### 2.2 Escolher modo (`/mode`)
- Empresa ou Investidor (F-07). Guardado por endereço no `localStorage` (não é segredo). Pode trocar a qualquer momento pelo cabeçalho.

### 2.3 Conta confidencial (`/account/setup`)
- Explica: "Seu saldo para lances fica numa conta confidencial do token. A chave dela fica só neste navegador."
- Botão "Criar conta confidencial" → `client.account.ensureRegistered()` (prova `register` + tx) [carteira].
- Se já existe chave em outro navegador: "Importar backup" (2.5).
- Erros: `Token.*`, `KeyAlreadyExists`, `TxFailed`.

### 2.4 Backup obrigatório (`/account/backup`)
- Senha + confirmação (mínimo de 12 caracteres, o do SDK) → `client.account.exportBackup(senha)`, que leva a chave **e** as aberturas do saldo (S-22) → download `cmi-backup-<rede>-<conta>.txt`.
- Checkbox "Guardei o arquivo e a senha" → `keys.markBackedUp(conta, tokenAddrF)` (o `BrowserKeyProvider` da sessão).
- Bloqueia depósito e criação de leilão até concluir.
- Botão "Atualizar backup" na tela da carteira: um backup recente leva o saldo atual e dispensa os eventos antigos da RPC.

### 2.5 Importar backup / esquecer chave (`/account/keys`)
- Importar: arquivo + senha → `client.account.importBackup(texto, senha)` → `client.account.sync()` (`InvalidBackup` traduzido; o retorno diz se o backup trazia o saldo).
- Esquecer neste navegador: `keys.forget(conta, tokenAddrF)` **e** `openings.forget(conta, tokenAddrF)` (o `BrowserOpeningStore`), com confirmação dupla e aviso de perda sem backup.

---

## 3. Carteira (`/wallet`, os dois modos)

- **Saldo XLM público** (Horizon/RPC clássico, F-05).
- **Saldo confidencial:** `client.account.sync()` ao abrir (SDK-B), depois `client.account.balance()` → gastável e a receber.
  - `BalanceOutOfSync` mesmo depois do `sync` → explica (atividade com mais de ~7 dias que este navegador não viu) e oferece importar um backup mais recente (F-08).
- **Depositar XLM** no saldo confidencial → `client.account.deposit(amount)` [carteira], seguido de `merge()` [carteira] para ficar gastável.
  - Aviso fixo: "O valor do depósito é público." Botão "Sugerir valor" (F-12).
- **Receber e tornar gastável:** `client.account.sync()` (traz reembolsos e pagamentos recebidos para o saldo "a receber") + `client.account.merge()` [carteira]. Mostra quanto entrou.
- **Saque para XLM público:** desabilitado, com explicação: "em breve" (fora do MVP, SDK-C, F-14).

---

## 4. Empresa

### 4.1 Painel da empresa (`/company`)
- Pré-requisitos com status: carteira conectada · conta confidencial · backup · XLM ≥ reserva · cotas disponíveis do ativo.
- "Meus leilões": `markets.list()` filtrado por `seller == eu`, com estado e ações (abrir, cancelar, ver recebimentos).
- Atalho: "Como gerar um token de teste" → o comando `pnpm token:issue` (F-13), o botão "Habilitar ativo" (trustline com a Freighter) e, com a carteira dev, "Gerar token de teste".

### 4.2 Criar leilão (`/company/new`) — wizard
1. **Ativo:** endereço do SAC das cotas (com leitura do saldo da empresa no SAC e do código do ativo). Aviso: o ativo não pode ter clawback (D18).
2. **Quantidade e preço:** total de cotas (`u32`, ≤ saldo), preço mínimo por cota em XLM (público).
3. **Prazo:** duração do lance aberto, em minutos, horas ou dias (até 30 dias, `MAX_DURATION_LEDGERS`) → `closeLedger = ledgerAtual + ceil(duração / segundosPorLedger)` (F-10).
4. **Reserva de taxa:** padrão 5 XLM (`MIN_FEE_RESERVE`), explicando o reembolso do que sobrar.
5. **Resumo:** taxa da casa 10%; exemplo "por cota vendida a P, você recebe 0,9·P"; regras: máximo 8 lances, 1 por carteira, pay-as-bid.
- Envio: `checkMarketParams` → `client.seller.createMarket(params, registerDataProvider)` [carteira] → oferta imediata de "Abrir agora" → `client.seller.openMarket(marketId)` [carteira].
- Erros: `Factory.InvalidTotalQuotas`, `InvalidMinPrice`, `InvalidCloseLedger`, `DurationTooLong`, `InvalidFeeReserve`, `SellerNotRegistered`, `FeeWalletNotRegistered`, `ResourceContention`.

### 4.3 Gerenciar leilão (`/company/market/:id`)
- Detalhe (1.2) + estado de custódia das cotas.
- `Created` → "Abrir (travar cotas)" [carteira]; `Created` ou `Open` sem lances → "Cancelar" [carteira] (`Auction.HasBids` traduzido).
- Depois do settlement: **Recebimentos** → `client.seller.proceeds(marketId)` (por vencedor: cotas e valor recebido, que é o preço do vencedor × cotas × 90%) + "Receber e tornar gastável" (`sync` + `merge`). `received: null` = "liquidado; valor fora do histórico do RPC (~7 dias)", nunca mostrar como zero (S-23).
- Cotas não vendidas e falhas: mostra o que voltou (`MarketFinalized.unsold`, `BidFailed`).

---

## 5. Investidor

### 5.1 Dar lance (`/market/:id/bid`)
- Ao abrir: pré-aquece o `Prover`.
- **Checklist** antes do formulário:
  - trustline da cota → senão "Habilitar cota" (`changeTrust`) [carteira] (`NoTrustline`, `recovery: change_trust`);
  - conta confidencial e backup;
  - saldo gastável (mostrado) vs. `preço × quantidade` (calculado ao digitar).
- **Formulário:** preço por cota (XLM, ≥ piso, mostrado) e quantidade (inteiro > 0, aviso se > total).
- "Preparar lance" → `client.bidder.prepareBid(...)`; pode pedir `register_participant` [carteira]; depois, as duas provas com progresso.
- **Confirmação:** resumo (preço, quantidade, total travado, prazo da trava `setSpender.liveUntilLedger`), avisos (`DepositRevealsPrice`). "Travar e enviar" → `client.bidder.placeBid(prepared)` → `set_spender` [carteira] → `submit_bid` [carteira].
- Sucesso: "Lance aceito (#bidIndex)". O preço é descartado da memória.
- Erros antes da trava: `BelowMinPrice`, `PriceOutOfRange`, `MarketNotOpen`, `BiddingClosed`, `MarketFull`, `AlreadyBid`, `InsufficientBalance`, `BalanceOutOfSync`, `KeyNotFound`, `ProofFailed`.
- Erros depois da trava (`recovery: "revoke_spender"`): tela de recuperação (5.3).
- `Token.DelegationAlreadyExists` → explica que é preciso recuperar o colateral antes de outro preço.

### 5.2 Meus lances (`/investor`)
- Para cada mercado em que a carteira tem lance: `client.bidder.status(marketId)` → estado, pedido, alocado, reembolso (decifrado). `Settled` com `refund: null` = "valor fora do histórico do RPC" (S-23). Ações:
  - "Receive refunds" (`sync` + `merge`) [carteira]; as cotas chegam direto na carteira clássica (trustline), sem ação. O painel mostra o saldo **`receiving`** da conta (`sync` + `account.balance()`), e o botão só fica ativo quando ele é maior que zero. Os reembolsos decifrados nas linhas são histórico e não diminuem com o merge;
  - lance `Pending` em mercado `Cancelled` aparece como "Auction cancelled", e em `Closed` com o `finalize_by_ledger` vencido como "Settlement deadline passed". Nenhum dos dois conta como "awaiting allocation";
  - "Recover collateral" (`client.bidder.recoverCollateral`) na linha do lance quando ele está `Pending`, o mercado está `Cancelled` ou `Closed` com o `finalize_by_ledger` vencido, **e** `client.token.delegation(eu, auction)` não é `null`. Com o lance em jogo (`Open`, ou `Closed` dentro do prazo) o botão não aparece.
- Descoberta dos mercados: varredura de `markets.list()` procurando `bidder == eu` (só leitura; cache).

### 5.3 Recuperar colateral (`/market/:id/recover`)
- Quando: `submit_bid` falhou depois do lock, mercado cancelado sem operador, ou operador fora do ar (G8).
- `client.bidder.recoverCollateral(marketId)` (prova `revoke_spender` + tx) [carteira].
- Aviso: depois de recuperar num mercado `Finalized`, as cotas daquele lance voltam para a empresa (`release_unsettled`).

---

## 6. Operador

**Não há tela do operador** (F-04): ele é outro sistema. O front mostra o progresso dele no detalhe do leilão (1.2) e oferece as ações permissionless (fechar, cancelar por timeout) a qualquer carteira.
