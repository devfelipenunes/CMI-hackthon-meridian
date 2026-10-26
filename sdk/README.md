# CMI Auctions — TypeScript SDK

> **Monorepo.** Este projeto vive em `sdk/` no monorepo CMI Auctions. O setup canônico é o [README da raiz](../README.md); as instruções de submódulo/SSH abaixo descrevem o repositório standalone original.

SDK TypeScript do **CMI Auctions**: leilão confidencial de cotas de RWA na Stellar/Soroban
(multi-unidade, *pay-as-bid*, lance selado, provas UltraHonk/Noir).

- Planejamento, arquitetura e roadmap: [`docs/`](docs/README.md)
- Especificação (fonte da verdade): [`specs/`](specs/) (submódulo)
- Contratos e circuitos: [`contracts/`](contracts/) (submódulo)

## Desenvolvimento

```bash
git submodule update --init --recursive
./scripts/check-toolchain.sh     # Node >= 22, pnpm
pnpm install
pnpm lint                        # eslint + fronteiras entre pacotes + typecheck
pnpm test                        # unit + parity + circuits
```

O fluxo é TDD, um passo do [`docs/ROADMAP.md`](docs/ROADMAP.md) por PR. Processo, guardrails e mapa de
reuso dos POCs: skill [`.claude/skills/cmi-sdk-tdd`](.claude/skills/cmi-sdk-tdd/SKILL.md).
