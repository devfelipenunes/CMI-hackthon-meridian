---
name: cmi-sdk-tdd
description: Orienta mudanças no SDK TypeScript do CMI Auctions, incluindo provas ZK, integração Stellar/Soroban e os testes de paridade do protocolo.
---

# Desenvolvimento do SDK CMI

Use este fluxo ao implementar, revisar ou testar os pacotes `artifacts`, `core`,
`client`, `operator` e `testing`.

## Fontes e dependências

- `specs/` define produto, RFs, ADRs e invariantes de segurança; `contracts/`
  define a interface on-chain e os vetores oficiais.
- Consulte `docs/ROADMAP.md`, `docs/API.md`, `docs/TESTING.md` e
  `docs/DECISIONS.md` antes de uma alteração de protocolo.
- O código de terceiros vem exclusivamente de
  `third_party/stellar-confidential-token-demo`, fixado no commit declarado pelo
  submódulo. Não versione uma cópia vendorizada em `packages/core`.
- Nunca edite `specs/` nem `contracts/` para contornar uma divergência; pare e
  peça a mudança na fonte de verdade.

## Fluxo de mudança

1. Escreva o teste vermelho que descreve o comportamento antes da implementação.
2. Implemente o mínimo, refatore e execute `pnpm lint` e `pnpm test`.
3. Para witnesses, provas ou bundle de navegador, execute também os projetos de
   teste apropriados (`test:proving` e `test:browser`).
4. Documente mudanças de interface no `docs/API.md` e mantenha o roadmap fiel
   ao estado verificado.

Veja [o mapa de reuso](references/reuse.md) e o
[modelo de entrega](references/pr-template.md).

## Guardrails

- Nunca escreva uma fórmula duas vezes: commitment, nullifier, leaf, root e
  witnesses têm uma implementação canônica em `packages/core` e paridade com os
  vetores oficiais.
- Mantenha `@noir-lang/noir_js` em `1.0.0-beta.9`, `@aztec/bb.js` em `0.87.0`
  e o transcript `keccak`.
- O fluxo do lance é sempre `bid_validity` → `set_spender` → `submit_bid`.
- O pacote `operator` nunca pode entrar no bundle do navegador.
- Valores financeiros, campos e escalares são `bigint`; `number` fica restrito
  a índices, contagens e ledgers `u32`.
- Segredos usam `Secret<T>` e cada fluxo deve verificar ausência de vazamento
  com `assertNoSecretLeak`.
- Nunca marque um RF como `DONE` com base em fake: a condição de fechamento
  precisa da evidência real definida no roadmap.
- O submódulo não é alterado por cópia de código; atualize apenas seu commit
  fixado, com testes de paridade verdes.
- Não execute `git push`, não abra PR nem faça merge sem autorização explícita.
