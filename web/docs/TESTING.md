# Testes — estratégia TDD do front

Cada passo do [ROADMAP](ROADMAP.md) começa pelos testes listados nele, que falham, e termina quando todos passam. O front **não testa o protocolo** (isso é do SDK): ele testa que chama o SDK certo, na ordem certa, mostra o estado certo e não vaza segredo.

---

## 1. Níveis

| Nível | Pergunta | Ferramenta | Onde fica | Roda em |
|---|---|---|---|---|
| **Unitário** | a função de domínio (formatação, data ↔ ledger, erros, sugestão de depósito) está certa? | Vitest (`unit`) | `app/test/unit/` | todo commit, < 10 s |
| **Componente/fluxo** | a tela chama o SDK certo, na ordem certa, e mostra cada estado e erro? | Vitest + Testing Library + jsdom, com **fakes do SDK** | `app/test/flows/` | todo commit |
| **Bundle** | o build não tem `operator`/`testing` e cabe no orçamento? | Vitest sobre `dist/modules.json` | `app/test/bundle/` | todo commit que muda dependências ou `vite.config` |
| **Navegador** | prova, IndexedDB e WebCrypto funcionam num Chromium de verdade? | Vitest browser mode + Playwright | `app/test/browser/` | sob demanda e antes do PR |
| **Integração** | os scripts (`sync-deployment`, `register-data`, `issue-quota-token`) e os serviços do app funcionam na testnet? | Vitest + testnet | `scripts/test/`, `app/test/integration/` | sob demanda (rede pública: lento, depende do friendbot) |
| **E2E** | o leilão inteiro funciona **pelo app**? | Playwright + testnet + operador externo (F-04) | `e2e/` | antes do PR final |

```bash
pnpm test               # unit + flows + bundle
pnpm test:browser       # Chromium headless (uma vez: pnpm exec playwright install chromium)
pnpm test:integration   # testnet
pnpm e2e                # testnet; exige o config com register_data e o operador rodando
pnpm lint               # eslint + dependency-cruiser + tsc --noEmit
```

---

## 2. O ciclo de cada passo

```text
1. escrever os testes do passo           → pnpm test  ⇒ VERMELHO   (commit "test(...)")
2. implementar o mínimo para passar      →            ⇒ VERDE      (commit "feat(...)")
3. refatorar mantendo verde              → pnpm lint
4. atualizar docs/ se algo mudou (SCREENS, ARCHITECTURE, DECISIONS)
5. marcar o passo no ROADMAP
```

---

## 3. Padrões obrigatórios

### 3.1 Fakes do SDK, não mocks soltos

Os fluxos recebem o `CmiClient` por contexto React. Nos testes, o contexto recebe um `CmiClient` montado sobre os **fakes do próprio SDK** (`@zolvency-cmi/testing`: `FakeFactory`, `FakeAuction`, `FakeToken`, `FakeQuota`, `FakeProver`, `SeededRng`, `FakeClock`), como no `ClientContext`. Assim o teste de tela usa o comportamento real das APIs do client (preflight, ordem do lance, erros tipados), sem rede e sem prova real.

`vi.mock` do SDK só para simular falhas que os fakes não produzem (ex.: carteira recusou assinar).

### 3.2 Ordem e ausência de chamadas

Copiado do TESTING §3.3 do SDK, do lado da UI:
- `BelowMinPrice` não abre a carteira nem chama o token;
- "Travar e enviar" só aparece depois do `prepareBid` terminar;
- a carteira é chamada na ordem `set_spender` → `submit_bid`;
- `createMarket` não é chamado se `checkMarketParams` falha.

O registro de chamadas dos fakes (`calls.all()`) é a asserção.

### 3.3 Nenhum segredo vaza (F-11)

Teste de auditoria por fluxo com preço (lance, confirmação, erro depois da trava):
- usa um preço distintivo (ex.: `777_777_777n`) e procura esse valor, e `price × qty`, em: `localStorage`, `sessionStorage`, `location.href`, `console.*` (espiado), o cache do TanStack Query serializado, o texto renderizado **depois** do envio, e as mensagens de erro;
- reaproveita o `assertNoSecretLeak` do `@zolvency-cmi/testing`.

### 3.4 Valores grandes

Toda conversão de XLM/cotas é testada com valores acima de `2^53` (ex.: `9_000_000_000 XLM`) e com 7 casas decimais; nunca `Number` para valor.

### 3.5 Tabelas

Tradução de erros e transições de estado da tela são testadas por tabela: cada `CmiErrorCode` que a tela pode receber tem mensagem e ação; cada `MarketStatus` × modo × ledger tem as ações certas visíveis.

---

## 4. Ambiente (testnet)

| Peça | Como |
|---|---|
| Rede | testnet pública (`soroban-testnet.stellar.org`), ~5 s por ledger |
| Plataforma | deploy `v0.1.0-rc.4` já feito (F-06), carência de 120 ledgers (~10 min) |
| Config do app | `pnpm sync:deployment` grava `app/public/config/testnet.json`; `register_data` pela F-03 |
| Operador | o seu sistema (F-04); na falta dele, o keeper do SDK chamado **pelo teste** |
| Contas | carteira dev + friendbot da testnet |

Cuidados: a testnet é compartilhada (lenta em picos, `ResourceContention` possível), o friendbot tem limite, e a SDF zera a rede periodicamente (depois de um reset, reimplantar e rodar o `sync:deployment`).

---

## 5. E2E (`e2e/`)

Roteiro único, na testnet, com a carteira dev (a Freighter não é automatizável):

1. **Empresa:** conecta, modo Empresa, conta confidencial + backup, gera o token de teste (botão dev), cria o leilão com os valores do §5.1 e abre. Confere: cotas em custódia, leilão `Open` na lista.
2. **Investidores (4 lances + 1 recusado):** cada um conecta, habilita a cota, cria a conta confidencial, deposita (valor sugerido) e dá o lance do §5.1. A Eva tenta abaixo do piso: `BelowMinPrice`, nenhuma assinatura, nada travado.
3. **Público:** a lista e o detalhe mostram demanda e contagem, **nunca preço** (auditoria de DOM).
4. **Fechamento:** um investidor clica "Fechar leilão" depois do `closeLedger`.
5. **Operador (externo):** `finalize` e `settle` de cada lance. O app mostra o progresso.
6. **Resultado:** cada investidor vê o alocado e o reembolso e faz `sync` + `merge`; a empresa vê os recebimentos (90% de cada pagamento). Os números esperados estão no §5.1.
7. **Persistência:** recarregar a página e trocar de contexto de navegador (importando o backup) mantém o saldo utilizável (SDK-A/B).
8. **Timeout:** um segundo leilão sem operador → ~10 min depois do fechamento, "Cancelar por timeout" → "Recuperar colateral".

### 5.1 Valores do cenário na testnet

Unidades: **preço por cota em stroops** (1 XLM = 10.000.000), quantidade em cotas inteiras. O colateral é `preço × quantidade`, também em stroops. O friendbot dá 10.000 XLM por conta, então os valores ficam pequenos. A taxa da casa é 10% (`FEE_BPS = 1000`).

| Parâmetro | Valor |
|---|---|
| Total de cotas | 100 (`issue-quota-token --amount 100`) |
| Preço mínimo por cota | 1 XLM (`10_000_000n`) |
| Reserva de taxa | 5 XLM (`MIN_FEE_RESERVE`) |
| Fechamento | ledger atual + `2 × lances × 90 s / 5 s` ≈ +150 ledgers (~12 min); a regra do `bidWindow` do SDK |
| Carência do operador | 120 ledgers (~10 min), a do deploy da testnet |

| Lance | Preço/cota | Pede | Colateral | Alocado | Paga (bruto) | Empresa recebe (90%) | Reembolso |
|---|---|---|---|---|---|---|---|
| Ana | 3 XLM | 40 | 120 XLM | 40 | 120 XLM | 108 XLM | 0 |
| Bruno | 2,5 XLM | 50 | 125 XLM | 50 | 125 XLM | 112,5 XLM | 0 |
| Carla | 2 XLM | 30 | 60 XLM | **10** (parcial) | 20 XLM | 18 XLM | 40 XLM |
| Diego | 1,5 XLM | 20 | 30 XLM | 0 | 0 | 0 | 30 XLM |
| Eva | 0,5 XLM | 10 | — | recusado (`BelowMinPrice`) | — | — | — |

- **Totais:** a empresa recebe 238,5 XLM; a fee wallet, 26,5 XLM; não sobra cota (40 + 50 + 10 = 100).
- **Depósitos sugeridos** (nunca o valor exato do colateral, F-12): Ana 150, Bruno 150, Carla 75, Diego 40 XLM.
- **Se os números não fecharem,** a referência é o `settlementAmounts` do SDK (`core/allocation`), não esta tabela.

Pronto quando: o roteiro passa do começo ao fim, e o teste de auditoria do DOM e do storage não acha nenhum preço.
