import { CmiError, type Clock, type ContractId, type SettleOutcome } from "@zolvency-cmi/core";

import type { CmiOperator } from "../operator.js";
import { planNextAction, type KeeperAction } from "./planner.js";
import { KeeperScheduler, type RetryPolicy } from "./scheduler.js";

export type KeeperEvent =
  | { kind: "action"; auction: ContractId; action: KeeperAction; ledger: number }
  | { kind: "settled"; auction: ContractId; bidIndex: number; outcome: SettleOutcome; ledger: number }
  | { kind: "retry"; auction: ContractId; action: KeeperAction["kind"]; bidIndex?: number; code: string; untilLedger: number }
  | { kind: "failed"; auction: ContractId; action: KeeperAction["kind"]; bidIndex?: number; code: string; attempts: number }
  | { kind: "quarantined"; auction: ContractId; bidIndex: number };

export interface KeeperOptions {

  clock: Clock;
  retry?: RetryPolicy;
  onEvent?: (e: KeeperEvent) => void;
}

export class Keeper {
  readonly #op: CmiOperator;
  readonly #clock: Clock;
  readonly #emit: (e: KeeperEvent) => void;
  readonly #scheduler: KeeperScheduler;

  constructor(op: CmiOperator, opts: KeeperOptions) {
    this.#op = op;
    this.#clock = opts.clock;
    this.#emit = opts.onEvent ?? (() => undefined);
    this.#scheduler = new KeeperScheduler(opts.retry);
  }

  async tick(auction: ContractId): Promise<KeeperAction> {
    const ledger = await this.#clock.ledger();
    const snapshot = this.#scheduler.view(auction, await this.#op.snapshot(auction));
    const action = planNextAction(snapshot, ledger);
    if (action.kind === "wait" || action.kind === "done") return action;
    if (action.kind === "settle" && !this.#scheduler.canSettle(ledger)) return { kind: "wait", untilLedger: ledger + 1 };

    this.#emit({ kind: "action", auction, action, ledger });
    const bidIndex = "bidIndex" in action ? action.bidIndex : undefined;
    try {
      await this.#execute(auction, action, ledger);
    } catch (e) {
      const code = e instanceof CmiError ? e.code : "UnexpectedError";
      if (code === "ResourceContention") {
        this.#emit({ kind: "retry", auction, action: action.kind, ...(bidIndex === undefined ? {} : { bidIndex }), code, untilLedger: ledger + 1 });
        return { kind: "wait", untilLedger: ledger + 1 };
      }
      if (bidIndex === undefined) {
        this.#emit({ kind: "failed", auction, action: action.kind, code, attempts: 1 });
        return action;
      }
      const quarantined = this.#scheduler.failed(auction, bidIndex);
      this.#emit({ kind: "failed", auction, action: action.kind, bidIndex, code, attempts: this.#scheduler.attempts(auction, bidIndex) });
      if (quarantined) this.#emit({ kind: "quarantined", auction, bidIndex });
    }
    return action;
  }

  async run(auctions: AsyncIterable<ContractId>, signal: AbortSignal): Promise<void> {
    for await (const auction of auctions) {
      if (signal.aborted) return;
      try {
        await this.tick(auction);
      } catch (e) {

        this.#emit({ kind: "failed", auction, action: "wait", code: e instanceof CmiError ? e.code : "UnexpectedError", attempts: 1 });
      }
      if (signal.aborted) return;
    }
  }

  async #execute(auction: ContractId, action: Exclude<KeeperAction, { kind: "wait" } | { kind: "done" }>, ledger: number): Promise<void> {
    const port = this.#op.auctionPort(auction);
    const submitter = await this.#op.submitter();
    switch (action.kind) {
      case "close":
        await port.closeMarket(submitter);
        return;
      case "finalize": {
        const { filled, proof } = await this.#op.proveAllocation(await this.#op.planAllocation(auction));
        await port.finalize(submitter, filled, proof);
        return;
      }
      case "cancel_expired":
        await port.cancelExpired(submitter);
        return;
      case "settle": {
        const payload = await this.#op.buildSettlement(auction, action.bidIndex);
        this.#scheduler.settleSent(ledger);
        const outcome = await port.settle(submitter, action.bidIndex, payload, payload.proof);
        this.#emit({ kind: "settled", auction, bidIndex: action.bidIndex, outcome, ledger });
        return;
      }
      case "release_unsettled":
        await port.releaseUnsettled(submitter, action.bidIndex);
        return;
    }
  }
}
