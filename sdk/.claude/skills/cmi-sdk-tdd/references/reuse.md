# Mapa de reuso

- `third_party/stellar-confidential-token-demo/packages/sdk`: primitivas e
  integração do Confidential Token; é dependência de workspace, não código a
  copiar.
- `packages/core`: fórmulas canônicas, witnesses, portas e wrappers `Secret`.
- `packages/artifacts/dev-sources.json`: origem e checksum dos circuitos e VKs
  usados no desenvolvimento.
- `contracts/` e `specs/POC/`: vetores e evidências que orientam testes de
  paridade; não altere esses diretórios a partir do SDK.

Ao reutilizar uma implementação, preserve a lógica validada e cite o arquivo de
origem na entrega. Interfaces novas pertencem a `docs/API.md` e precisam de
teste positivo, negativo e de ausência de vazamento quando lidarem com segredo.
