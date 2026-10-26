# AGENTS.md — web

## Missão

Construir o **front-end web do CMI Auctions**: leilão confidencial (lance selado, *pay-as-bid*) de cotas de RWA na Stellar testnet. Tem um modo **Empresa** (cria o leilão e trava as cotas), um modo **Investidor** (dá o lance com provas ZK no navegador) e uma visão pública (nunca mostra preços). **Não há back-end:** tudo passa pelo SDK (`sdk`), e a carteira do usuário assina. O operador (que apura e liquida) é outro sistema.

## Antes de qualquer código

1. [`README.md`](README.md): setup (submódulos por SSH, sem `--recursive`).
2. [`docs/README.md`](docs/README.md) e, nesta ordem: `docs/ARCHITECTURE.md`, `docs/SCREENS.md`, `docs/TESTING.md`, `docs/DECISIONS.md`, `docs/ROADMAP.md`.
3. A skill [`.claude/skills/cmi-front-tdd/SKILL.md`](.claude/skills/cmi-front-tdd/SKILL.md): fluxo TDD, guardrails e o mapa da API do SDK (`references/sdk-api.md`).
4. A jornada do usuário: `specs/user-history/quota-auction-journey.md`.

## Regras que não mudam

- **TDD:** testes vermelhos primeiro (commit `test(...)`), implementação depois (commit `feat(...)`), um par por passo do ROADMAP.
- **Branch:** `fase/2-app`, um PR final para a `main`. Push na branch; o merge é do dono do projeto.
- **Só o SDK fala com o protocolo.** Falta algo no SDK → pedido em `docs/requests/` e mudança **no repositório do SDK**, nunca um atalho aqui.
- **Nenhum preço vaza** (URL, storage, log, cache, erro). Teste de auditoria em todo fluxo com preço.
- **`@zolvency-cmi/operator` e `@zolvency-cmi/testing` fora do bundle do app.**
- **Valores em `bigint`** (stroops).
- **Status:** só no `docs/ROADMAP.md`.

## Submódulos

`sdk/` e `specs/` não são editados daqui. Atualizar o SDK = trocar o ponteiro do submódulo para um commit da `main` do SDK, num commit `chore(sdk): …`.
