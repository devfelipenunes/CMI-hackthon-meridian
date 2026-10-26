/**
 * Orçamento do bundle do client no navegador (S-14, medido no passo 6.2 com o `bidder-web`).
 *
 * Medição (2026-10-19, Vite 7.3.6, build de produção): o JS que carrega ao abrir a tela — app,
 * SDK do CMI, `@stellar/stellar-sdk` e a cola do bb.js — soma 1,38 MB (396 KB com gzip); o total
 * do `dist/assets`, com o bb.js (variantes com e sem threads, ~3,4 MB cada) e o WASM do ACVM
 * (3,8 MB) que só carregam na hora da prova, soma 12,7 MB.
 *
 * O orçamento é a medição com ~25% de folga: ele existe para pegar uma regressão (o código do
 * operador empacotado, um bb.js duplicado, uma dependência pesada nova), não para travar o SDK.
 */
export const BUNDLE_BUDGET = {
  appJsBytes: 1_750_000,
  totalBytes: 16_000_000,
} as const;
