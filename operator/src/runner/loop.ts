import { Keeper, type CmiOperator, type KeeperAction, type KeeperEvent } from "@zolvency-cmi/operator";
import type { Logger } from "pino";

import type { AlertService } from "../alerts/service.js";
import type { ServiceConfig } from "../config/load.js";
import type { ChainPorts, RecordedTx } from "../chain/ports.js";
import type { ActionOutcome, MarketRow, Repos } from "../db/repos.js";
import { errorCode } from "../errors.js";
import { discoverMarkets } from "../markets/discovery.js";
import { syncMarket } from "../markets/sync.js";
import { deadlineLevel, nextCheck, orderDue } from "../scheduler/next-check.js";
import type { InstanceLease } from "./lease.js";

const RPC_FAILURES_BEFORE_ALERT = 3;

export interface LoopReport {
  ledger: number | null;
  leader: boolean;
  discovered: bigint[];
  ticks: { marketId: bigint; action: KeeperAction["kind"] | "error"; outcome: ActionOutcome | null }[];
}

export interface LoopDeps {
  ports: ChainPorts;
  operator: CmiOperator;
  repos: Repos;
  alerts: AlertService;
  lease: InstanceLease;
  logger: Logger;
  tuning: ServiceConfig["tuning"];

  retry?: { maxAttempts: number };
}

export class OperatorLoop {
  readonly #d: LoopDeps;
  readonly #keeper: Keeper;

  #ledger = 0;

  #events: KeeperEvent[] = [];
  #paused = false;
  #rpcFailures = 0;
  #last: LoopReport | null = null;
  #running = false;
  #wake: (() => void) | null = null;

  constructor(d: LoopDeps) {
    this.#d = d;

    this.#keeper = new Keeper(d.operator, {
      clock: { ledger: async () => this.#ledger },
      onEvent: (e) => this.#events.push(e),
      ...(d.retry === undefined ? {} : { retry: d.retry }),
    });
  }

  get paused(): boolean {
    return this.#paused;
  }

  get running(): boolean {
    return this.#running;
  }

  get lastReport(): LoopReport | null {
    return this.#last;
  }

  pause(): void {
    this.#paused = true;
    this.#d.logger.warn("keeper paused");
  }

  resume(): void {
    this.#paused = false;

    this.#d.repos.markets.makeAllDue(0);
    this.#d.logger.warn("keeper resumed");
    this.#wake?.();
  }

  release(): void {
    this.#d.lease.release();
  }

  requestDiscovery(): void {
    this.#d.repos.meta.delete("last_discovery_ledger");
    this.#wake?.();
  }

  resync(marketId: bigint): boolean {
    const m = this.#d.repos.markets.get(marketId);
    if (m === null) return false;
    this.#d.repos.markets.setNextCheck(marketId, 0, m.backoffAttempts);
    this.#wake?.();
    return true;
  }

  prepareRestart(): void {
    this.#d.repos.markets.makeAllDue(0);
    this.#d.repos.bids.clearQuarantine();
  }

  async runOnce(): Promise<LoopReport> {
    const { ports, repos, logger, tuning } = this.#d;
    const report: LoopReport = { ledger: null, leader: false, discovered: [], ticks: [] };
    let ledger: number;
    try {
      ledger = await ports.latestLedger();
      this.#rpcFailures = 0;
    } catch (e) {
      this.#rpcFailures += 1;
      logger.warn({ err: e, failures: this.#rpcFailures }, "latestLedger failed");
      if (this.#rpcFailures >= RPC_FAILURES_BEFORE_ALERT) {
        this.#d.alerts.raise({ severity: "critical", kind: "RpcUnavailable", marketId: null, bidIndex: null, message: `the RPC failed ${this.#rpcFailures} times in a row (${errorCode(e)})` });
      }
      this.#last = report;
      return report;
    }
    this.#ledger = ledger;
    report.ledger = ledger;
    repos.meta.set("last_loop_ledger", String(ledger));

    const lastDiscovery = Number(repos.meta.get("last_discovery_ledger") ?? "-1");
    if (lastDiscovery < 0 || ledger >= lastDiscovery + tuning.discoveryEveryLedgers) {

      repos.meta.set("last_discovery_ledger", String(ledger));
      try {
        report.discovered = await discoverMarkets({ ports, repos, alerts: this.#d.alerts, logger, ledger });
      } catch (e) {
        logger.warn({ err: e }, "discovery failed; retrying next loop");
      }
    }

    report.leader = this.#d.lease.acquire();
    if (!report.leader) {
      logger.debug("no lease: another instance is active");
      this.#last = report;
      return report;
    }

    for (const m of orderDue(repos.markets.due(ledger), ledger)) {
      report.ticks.push(await this.#tickMarket(m, ledger));
    }
    this.#last = report;
    return report;
  }

  async #tickMarket(m: MarketRow, ledger: number): Promise<LoopReport["ticks"][number]> {
    const { ports, repos, logger, tuning } = this.#d;
    ports.txSink.drain();
    this.#events = [];
    let action: KeeperAction | null = null;
    let failed = false;
    let code: string | null = null;

    if (this.#paused) {

      await this.#sync(m, ledger);
      repos.markets.setNextCheck(m.marketId, ledger + Math.min(tuning.reconcileLedgers, 12), m.backoffAttempts);
      return { marketId: m.marketId, action: "wait", outcome: null };
    }

    this.#d.lease.acquire();
    try {
      action = await this.#keeper.tick(m.address);
    } catch (e) {

      failed = true;
      code = errorCode(e);
      logger.warn({ err: e, marketId: m.marketId }, "keeper tick failed to read the market");
    }
    const events = this.#events;
    const failure = events.find((e) => e.kind === "failed");
    if (failure !== undefined && failure.kind === "failed") {
      failed = true;
      code = failure.code;
    }

    let outcome: ActionOutcome | null = null;
    if (action !== null && action.kind !== "wait" && action.kind !== "done") {
      outcome = this.#outcome(events);
      this.#record(m, action, ledger, outcome, code, ports.txSink.drain());
    } else if (action === null) {
      outcome = "failed";
    }
    if (action?.kind === "wait" && events.some((e) => e.kind === "retry")) outcome = "retry";

    this.#d.alerts.fromKeeperEvents(m.marketId, events);
    for (const e of events) if (e.kind === "quarantined") repos.bids.setQuarantined(m.marketId, e.bidIndex, true);

    await this.#sync(m, ledger);
    const fresh = repos.markets.get(m.marketId) ?? m;
    const level = deadlineLevel(fresh, ledger, tuning.deadlineWarnLedgers);
    if (level !== null) {
      this.#d.alerts.raise({
        severity: level,
        kind: "DeadlineNear",
        marketId: m.marketId,
        bidIndex: null,
        message: `market ${m.marketId}: ${fresh.finalizeByLedger - ledger} ledgers left to finalize (finalize_by_ledger ${fresh.finalizeByLedger})`,
        dedupKey: `DeadlineNear:${m.marketId}:${level}`,
      });
    }

    const n = nextCheck({ action, failed, ledger, backoffAttempts: m.backoffAttempts, finalizeByLedger: fresh.finalizeByLedger, tuning });
    repos.markets.setNextCheck(m.marketId, n.next, n.backoffAttempts);
    if (action !== null && action.kind !== "wait") logger.info({ marketId: m.marketId, action, outcome, code, next: n.next }, "keeper tick");
    return { marketId: m.marketId, action: action?.kind ?? "error", outcome };
  }

  #outcome(events: readonly KeeperEvent[]): ActionOutcome {
    if (events.some((e) => e.kind === "quarantined")) return "quarantined";
    if (events.some((e) => e.kind === "failed")) return "failed";
    if (events.some((e) => e.kind === "retry")) return "retry";
    if (events.some((e) => e.kind === "settled" && e.outcome === "AlreadySettled")) return "already_settled";
    return "ok";
  }

  #record(m: MarketRow, action: KeeperAction, ledger: number, outcome: ActionOutcome, code: string | null, txs: RecordedTx[]): void {

    const tx = txs.filter((t) => t.contract === m.address).at(-1) ?? null;
    this.#d.repos.actions.insert({
      marketId: m.marketId,
      kind: action.kind,
      bidIndex: "bidIndex" in action ? action.bidIndex : null,
      ledger,
      outcome,
      code: outcome === "ok" || outcome === "already_settled" ? null : code,
      txHash: tx?.hash ?? null,
      feeCharged: tx?.feeCharged ?? null,
      cpuInsns: tx?.cpuInsns ?? null,
    });
  }

  async #sync(m: MarketRow, ledger: number): Promise<void> {
    try {
      await syncMarket({ ports: this.#d.ports, repos: this.#d.repos }, m, ledger);
    } catch (e) {
      this.#d.logger.warn({ err: e, marketId: m.marketId }, "market sync failed");
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    this.#running = true;
    try {
      while (!signal.aborted) {
        try {
          await this.runOnce();
        } catch (e) {
          this.#d.logger.error({ err: e }, "loop iteration failed");
        }
        await new Promise<void>((resolve) => {
          const t = setTimeout(done, this.#d.tuning.loopIntervalMs);
          function done(): void {
            clearTimeout(t);
            signal.removeEventListener("abort", done);
            resolve();
          }
          this.#wake = done;
          signal.addEventListener("abort", done, { once: true });
        });
        this.#wake = null;
      }
    } finally {
      this.#running = false;
      this.#d.lease.release();
    }
  }
}
