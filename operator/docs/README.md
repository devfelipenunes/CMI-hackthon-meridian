# Operator documentation

The project's entry point is the [root README](../README.md). The in-depth documents live here.

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the service is divided, how it schedules by ledger, a market's flow, concurrency, and security |
| [API.md](API.md) | External and internal contract: routes, configuration, database schema, modules, CLI, and errors |
| [DECISIONS.md](DECISIONS.md) | Why each choice was made (OP-01..OP-22), with rejected alternatives |
| [RUNBOOK.md](RUNBOOK.md) | Operations: first start, local network, alerts, backup, upgrade |
| [requests/](requests/) | This project's requests to the contracts and the SDK |

To understand the system in five minutes, read the [README](../README.md) and then
[ARCHITECTURE.md](ARCHITECTURE.md) §2, which explains the service's most characteristic decision:
scheduling by ledger instead of by clock.
