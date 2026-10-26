# @zolvency-cmi/artifacts

Os circuitos (ACIR) e as chaves de verificação do CMI Auctions e do Confidential Token, de uma
release dos contratos, **sempre conferidos por sha256** antes do uso (um circuito diferente da VK
on-chain gera provas que o contrato recusa).

```ts
import { loadArtifacts } from "@zolvency-cmi/artifacts/node";       // Node: lê releases/<tag>/
import { ArtifactSet, verifyArtifacts, SUPPORTED_CONTRACTS_TAGS } from "@zolvency-cmi/artifacts"; // navegador: monte o conjunto e confira

const artifacts = loadArtifacts({ release: "v0.1.0" });
```

- `SUPPORTED_CONTRACTS_TAGS = ["v0.1.0"]`.
- A release dos contratos traz os circuitos e VKs do CMI e as VKs do token; o circuito do token
  que faltar é completado pelo que o SDK fixa, e só se a VK for a mesma (S-06).
- No navegador, sirva os arquivos com o `SHA256SUMS` e monte um `ArtifactSet` (veja o exemplo
  `examples/bidder-web` do repositório).
