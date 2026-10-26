# Pedido 001 — `PK_operator` com escalar secreto no circuito `bid_validity`

**Para:** `contracts` · **De:** operator · **Decisão local:** OP-10 · **Status:** adiado (2026-10-20). O MVP de teste usa a chave dos POCs (OP-10); este pedido vale quando houver uso real

## Contexto

- D-06 dos contratos: o `PK_operator` é uma constante (`global`) do circuito `bid_validity`.
- Na `v0.1.0-rc.4` ele é `987654321098 · G`, o escalar documentado nos POCs (`BID_VALIDITY_PK_OPERATOR` no SDK, teste `pk_operator_is_the_documented_key` no circuito).
- Os envelopes ficam na storage do contrato (ADR-024 D8). Com o escalar público, **qualquer pessoa** decifra todos os envelopes e lê todos os preços. Isso quebra G1/G2 e SECURITY S1 para o público, não só a visibilidade aceita do operador (ADR-024 D2).

## Pedido

1. Uma release cujo `bid_validity` use um `PK_operator` gerado pelo operador, sem que o escalar apareça em nenhum repositório. O operador entrega **só o ponto** (`x`, `y`), gerado por `keys generate envelope --for-circuit` deste serviço.
2. O teste do circuito passa a conferir o ponto contra um valor de configuração do build, e não contra um escalar.
3. Um modo de build de teste que continue usando o escalar dos POCs (rede local e E2E), para os testes do SDK e daqui não precisarem da chave real.
4. O SDK atualiza `BID_VALIDITY_PK_OPERATOR` por release (ou passa a lê-lo dos artefatos). Pedido correspondente no SDK, se necessário.

## Impacto aqui

O serviço se recusa a subir se a chave de envelope importada não bater com o ponto do circuito em uso (`EnvelopeKeyMismatch`). Até este pedido ser atendido, ele usa a chave dos POCs, com o aviso no `/v1/status`.
