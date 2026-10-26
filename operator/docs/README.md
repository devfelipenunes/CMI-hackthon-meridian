# Documentação do operador

O ponto de entrada do projeto é o [README da raiz](../README.md). Aqui ficam os documentos profundos.

| Documento | Conteúdo |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Como o serviço é dividido, como agenda por ledger, fluxo de um mercado, concorrência e segurança |
| [API.md](API.md) | Contrato externo e interno: rotas, configuração, schema do banco, módulos, CLI e erros |
| [DECISIONS.md](DECISIONS.md) | Por que cada escolha foi feita (OP-01..OP-22), com alternativas recusadas |
| [RUNBOOK.md](RUNBOOK.md) | Operação: primeira subida, rede local, alertas, backup, atualização |
| [requests/](requests/) | Pedidos deste repositório para os contratos e para o SDK |

Para entender o sistema em cinco minutos, leia o [README](../README.md) e depois
[ARCHITECTURE.md](ARCHITECTURE.md) §2, que explica a decisão mais característica do
serviço: agendar por ledger em vez de por relógio.
