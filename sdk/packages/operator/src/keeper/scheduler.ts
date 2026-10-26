import type { ContractId } from "@zolvency-cmi/core";

import type { MarketSnapshot } from "./planner.js";

export interface RetryPolicy {
  maxAttempts: number;
}

export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 3 };

export class KeeperScheduler {
  readonly #retry: RetryPolicy;
  #lastSettleLedger: number | null = null;
  readonly #attempts = new Map<string, number>();

  constructor(retry: RetryPolicy = DEFAULT_RETRY) {
    this.#retry = retry;
  }

  canSettle(ledger: number): boolean {
    return this.#lastSettleLedger !== ledger;
  }

  settleSent(ledger: number): void {
    this.#lastSettleLedger = ledger;
  }

  failed(auction: ContractId, bidIndex: number): boolean {
    const key = `${auction}#${bidIndex}`;
    const n = (this.#attempts.get(key) ?? 0) + 1;
    this.#attempts.set(key, n);
    return n === this.#retry.maxAttempts;
  }

  attempts(auction: ContractId, bidIndex: number): number {
    return this.#attempts.get(`${auction}#${bidIndex}`) ?? 0;
  }

  view(auction: ContractId, s: MarketSnapshot): MarketSnapshot {
    return {
      ...s,
      bids: s.bids.map((b, i) => (b.status === "Pending" && this.attempts(auction, i) >= this.#retry.maxAttempts ? { ...b, status: "Failed" as const } : b)),
    };
  }
}
