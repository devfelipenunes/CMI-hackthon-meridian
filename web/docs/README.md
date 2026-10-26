# CMI Auctions — Front-end (web)

Este repositório é o **front-end web** do CMI Auctions: um leilão confidencial de cotas de RWA na Stellar/Soroban, multi-unidade, *pay-as-bid* e de lance selado.

**Não há back-end próprio.** O front fala com a blockchain e gera as provas ZK **só pelo SDK** (`sdk`, submódulo). Ele não reimplementa criptografia, encoding, witness nem ordem de chamadas: só compõe o SDK, a carteira e as telas.

| Quem usa | Modo no front | O que faz | Pacote do SDK |
|---|---|---|---|
| **Empresa (seller)** | Empresa | registra a conta confidencial, cria o leilão, trava as cotas (abre), cancela, acompanha e lê os recebimentos | `client` (`seller`, `account`, `markets`) |
| **Investidor (bidder)** | Investidor | registra a conta confidencial, deposita XLM, dá o lance selado (2 provas no navegador), acompanha, recupera colateral, faz `merge` do reembolso | `client` (`bidder`, `account`, `markets`) |
| **Público** | sem carteira | vê os leilões, a demanda pública, o estado e o resultado (nunca preços) | `client` (`markets`) |
| **Operador (plataforma)** | **outro sistema**, fora deste repositório (F-04) | `finalize` com a prova `winner_allocation` e o `settle` de cada lance; é o único que vê os preços. O front só mostra o progresso pelos eventos | `operator` (só Node) |

**Rede:** testnet, com o deploy `v0.1.0-rc.4` dos contratos (F-06).

---

## Estado atual (2026-10-20)

- **Planejamento e preparação prontos.** O código ainda não começou: o desenvolvimento começa no passo **0.1** do [ROADMAP](ROADMAP.md), na branch `fase/2-app`.
- **SDK pronto para o front:** conta confidencial no navegador (S-22) e janela de eventos da RPC (S-23) na `main` do SDK (`0693e1f`), que é para onde o submódulo aponta. Nenhum passo do front espera mais o SDK.
- **Testnet:** deploy `v0.1.0-rc.4` no ar, conferido.
- **Operador:** sistema externo, ainda não existe. Enquanto isso, o `register_data` usa uma chave de desenvolvimento (F-03), e o teste de ponta a ponta roda o keeper do SDK dentro do teste.
- **Quem vai desenvolver:** [README da raiz](../README.md) (setup) → [AGENTS.md](../AGENTS.md) → skill [`cmi-front-tdd`](../.claude/skills/cmi-front-tdd/SKILL.md) → este índice.

---

## Índice

| Documento | Conteúdo |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Camadas, pastas, como o SDK entra no app, fluxos de cada pessoa, segurança |
| [SCREENS.md](SCREENS.md) | Telas, estados e o que cada tela chama no SDK |
| [TESTING.md](TESTING.md) | Estratégia TDD do front: níveis, fakes do SDK, E2E na testnet |
| [ROADMAP.md](ROADMAP.md) | Os passos (desenvolvidos de uma vez, numa fase só) e a **única fonte de status** |
| [DECISIONS.md](DECISIONS.md) | Decisões locais do front (F-01..F-16), incluindo as **abertas** |
| [requests/](requests/) | Pedidos deste repositório ao SDK (`001`: estado da conta confidencial) |

---

## Fontes da verdade

| Pasta | Papel |
|---|---|
| `sdk/` (submódulo) | **Manda nas regras de negócio e na API.** Código de `packages/{core,client,operator}` e `docs/API.md`. Em conflito com qualquer documento, vale o código do SDK |
| `sdk/contracts/` (submódulo do SDK) | Interface on-chain: `docs/CONTRACTS.md` (funções, erros, eventos) |
| `specs/` (submódulo) | Produto e jornada (`user-history/quota-auction-journey.md`), specs RF-01..RF-22, ADRs. **Pode estar desatualizado:** se diverge do SDK, vale o SDK |
| `docs/` (este) | **Como e em que ordem** o front é feito |

**Regra de conflito.**
- `docs/` contradiz o código do SDK → vale o SDK, e `docs/` é corrigido no mesmo commit.
- O front precisa de algo que o SDK não oferece → **não reimplementa**: registra um pedido em `docs/requests/`, a mudança é feita **no SDK** (F-14), e o submódulo é atualizado aqui.
- **Os submódulos não são editados daqui.**

---

## Fluxo de trabalho

Diferente do SDK (fases → PR por passo), o front é desenvolvido **de uma vez**, numa fase só (F-15):

```text
fase/2-app  ──commits por passo (teste vermelho, depois verde)──►  PR único para main
```

Antes do desenvolvimento, a preparação (`preparacao/dev`) entra na `main` por um PR próprio. Detalhe das branches na F-15.

- Cada passo do [ROADMAP](ROADMAP.md) continua com testes primeiro (TDD) e um "Pronto quando".
- Commits: `tipo(escopo): descrição`. O commit dos testes vermelhos vem separado do da implementação.
- A ordem dos passos é a das dependências. Passos independentes podem andar em paralelo.

## Regras que valem para todo commit

1. **TDD:** nenhum código de produção sem um teste vermelho antes ([TESTING.md](TESTING.md)).
2. **Só o SDK fala com o protocolo.** Nenhuma fórmula, hash, witness ou encoding no front. A exceção são operações **clássicas** da Stellar que o SDK não cobre (trustline, saldo XLM público, friendbot), feitas com `@stellar/stellar-sdk` na mesma versão do SDK (14.6.1).
3. **Nenhum segredo vaza:** preço, `price × qty`, chaves e aberturas nunca vão para URL, `localStorage`, log, telemetria, mensagem de erro, cache serializado ou estado global persistido. Preço só existe em memória, durante o lance (F-11).
4. **O pacote `operator` e o `packages/testing` nunca entram no bundle do app** (S-02 do SDK). A regra é checada por lint e por teste de bundle.
5. **Valores são `bigint`** (XLM em stroops, cotas em unidades base). `number` só para contagens, ledgers e `bid_index`.
6. **A carteira assina.** O app nunca pede nem guarda a chave Stellar do usuário (exceto a carteira de desenvolvimento, F-05).
7. **A ordem do lance é a do SDK:** `prepareBid` (provas, nada travado) → confirmação → `placeBid` (`set_spender` → `submit_bid`).
