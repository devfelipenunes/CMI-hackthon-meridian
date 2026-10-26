import {
  CmiError,
  chainAuctionPort,
  chainFactoryPort,
  chainTokenPort,
  marketVersion,
  type ChainClient,
  type ContractId,
  type Logger,
  type Prover,
} from "@zolvency-cmi/core";
import { CmiOperator, Keeper, type KeeperEvent, type OperatorKeyStore } from "@zolvency-cmi/operator";

export interface OperatorKeeperOptions {
  chain: ChainClient;
  contracts: { factory: ContractId; token: ContractId; auditor: ContractId };
  /** No back-end real, um `OperatorKeyStore` sobre o banco ou um HSM (S-11). */
  keys: OperatorKeyStore;
  prover: Prover;
  /** Os mercados que este operador acompanha (no back-end, a lista persistida). */
  markets: ContractId[];
  signal: AbortSignal;
  /** Espera entre voltas quando nenhum mercado tem ação agora. Padrão: 5 s (~1 ledger). */
  pollIntervalMs?: number;
  onEvent?: (e: KeeperEvent) => void;
  logger?: Logger;
}

/**
 * O laço do back-end do operador (RF-21, S-12): para cada mercado, confere a versão dos contratos
 * (S-18: o SDK só prova para um `auction.wasm` que conhece) e roda o keeper até o mercado terminar.
 * Um `tick` por mercado por volta; o keeper faz no máximo um `settle` por ledger. Devolve os
 * mercados que terminaram e os que foram pulados (com o código), quando acabam ou o `signal` aborta.
 */
export async function runOperatorKeeper(o: OperatorKeeperOptions): Promise<{ done: ContractId[]; skipped: { market: ContractId; code: string }[] }> {
  const { chain, contracts } = o;
  const operator = new CmiOperator({
    keys: o.keys,
    factory: chainFactoryPort({ chain, address: contracts.factory }),
    tokenAddress: contracts.token,
    prover: o.prover,
    auction: (address) => chainAuctionPort({ chain, address }),
    token: chainTokenPort({ chain, token: contracts.token, auditor: contracts.auditor }),
    ...(o.logger === undefined ? {} : { logger: o.logger }),
  });
  const keeper = new Keeper(operator, { clock: { ledger: () => chain.latestLedger() }, ...(o.onEvent === undefined ? {} : { onEvent: o.onEvent }) });

  const done: ContractId[] = [];
  const skipped: { market: ContractId; code: string }[] = [];
  const pending: ContractId[] = [];
  for (const market of o.markets) {
    try {
      await marketVersion(chain, market);
      pending.push(market);
    } catch (e) {
      skipped.push({ market, code: e instanceof CmiError ? e.code : "UnexpectedError" });
    }
  }

  const pause = (): Promise<void> =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, o.pollIntervalMs ?? 5_000);
      o.signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
    });

  while (pending.length > 0 && !o.signal.aborted) {
    let acted = false;
    for (const market of [...pending]) {
      if (o.signal.aborted) break;
      const action = await keeper.tick(market);
      if (action.kind === "done") {
        pending.splice(pending.indexOf(market), 1);
        done.push(market);
      } else if (action.kind !== "wait") {
        acted = true;
      }
    }
    if (!acted && pending.length > 0) await pause();
  }
  return { done, skipped };
}
