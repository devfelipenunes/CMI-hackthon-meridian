# @zolvency-cmi/core

O núcleo do SDK do CMI Auctions, usado pelo `client` (navegador e Node) e pelo `operator` (Node):

- **Cripto do protocolo:** Poseidon2, Grumpkin, commitment, nullifier e raiz dos lances, envelope
  ECDH para o operador, alocação por preço de corte e valores do settlement — cada fórmula uma
  vez só, com paridade provada contra os vetores dos contratos.
- **Provas UltraHonk** com `@noir-lang/noir_js 1.0.0-beta.9` e `@aztec/bb.js 0.87.0` (transcript
  keccak), no Node e no navegador: `createProver`.
- **Confidential Token** (OpenZeppelin): chaves, `register`, `set_spender`, `spender_transfer`,
  `revoke_spender`, leitura de saldo e de transferências recebidas.
- **Stellar/Soroban:** `ChainClient` (simulate, assinatura por `Signer`, eventos, erros tipados
  como `CmiError` com códigos estáveis) e as portas da Factory, da Auction e do token.
- **Versão por mercado** (`marketVersion`): o SDK só prova para um `auction.wasm` que conhece.

Segredos (preço, blindings, chaves) trafegam como `Secret<T>` e nunca vão para log, erro ou JSON.

No navegador, o `@stellar/stellar-sdk` precisa do `Buffer` (pacote `buffer`) e o bb.js/noir ficam
fora do pre-bundle do Vite (`optimizeDeps.exclude`). Este pacote embute o SDK do demo do token
(`@ctd/sdk`, MIT); veja `THIRD_PARTY_NOTICES.md`.
