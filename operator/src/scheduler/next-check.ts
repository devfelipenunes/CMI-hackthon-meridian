import type { MarketStatus } from "@zolvency-cmi/core";
import type { KeeperAction } from "@zolvency-cmi/operator";

const MARKET_ACTIONS: readonly KeeperAction["kind"][] = ["close", "finalize", "cancel_expired"];

export interface NextCheckInput {

  action: KeeperAction | null;

  failed: boolean;
  ledger: number;
  backoffAttempts: number;
  finalizeByLedger: number;
  tuning: { reconcileLedgers: number; backoffMaxLedgers: number };
}

export interface NextCheck {

  next: number | null;
  backoffAttempts: number;
}

export function nextCheck(i: NextCheckInput): NextCheck {
  const { action, ledger } = i;
  if (action !== null && action.kind === "done") return { next: null, backoffAttempts: 0 };
  if (action !== null && action.kind === "wait") {
    return { next: Math.max(ledger + 1, Math.min(action.untilLedger, ledger + i.tuning.reconcileLedgers)), backoffAttempts: i.backoffAttempts };
  }
  const marketLevel = action === null || MARKET_ACTIONS.includes(action.kind);
  if (!i.failed) return { next: ledger + 1, backoffAttempts: 0 };
  if (!marketLevel) return { next: ledger + 1, backoffAttempts: i.backoffAttempts };

  const attempts = i.backoffAttempts + 1;
  const delay = Math.min(2 ** Math.min(attempts, 30), i.tuning.backoffMaxLedgers);
  let next = ledger + delay;

  if (action?.kind === "finalize" || action === null) {
    const lastUseful = i.finalizeByLedger - 1;
    if (next > lastUseful) next = Math.max(ledger + 1, lastUseful);
  }
  return { next, backoffAttempts: attempts };
}

export interface DueMarket {
  marketId: bigint;
  status: MarketStatus;
  closeLedger: number;
  finalizeByLedger: number;
}

function rank(m: DueMarket, ledger: number): number {
  if (m.status === "Closed") return 0;
  if (m.status === "Open" && ledger >= m.closeLedger) return 1;
  if (m.status === "Finalized" || m.status === "Cancelled") return 2;
  return 3;
}

export function orderDue<T extends DueMarket>(markets: readonly T[], ledger: number): T[] {
  return [...markets].sort((a, b) => {
    const r = rank(a, ledger) - rank(b, ledger);
    if (r !== 0) return r;
    if (a.status === "Closed" && b.status === "Closed" && a.finalizeByLedger !== b.finalizeByLedger) return a.finalizeByLedger - b.finalizeByLedger;
    return a.marketId < b.marketId ? -1 : a.marketId > b.marketId ? 1 : 0;
  });
}

export type DeadlineLevel = "warning" | "critical";

export function deadlineLevel(m: { status: MarketStatus; finalizeByLedger: number }, ledger: number, warnLedgers: number): DeadlineLevel | null {
  if (m.status !== "Closed") return null;
  const remaining = m.finalizeByLedger - ledger;
  if (remaining < 0) return null;
  if (remaining <= Math.floor(warnLedgers / 2)) return "critical";
  if (remaining <= warnLedgers) return "warning";
  return null;
}
