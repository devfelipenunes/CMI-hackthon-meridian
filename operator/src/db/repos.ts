import type { BidStatus, MarketStatus } from "@zolvency-cmi/core";

import type { Db } from "./open.js";

export interface MarketRow {
  marketId: bigint;
  address: string;
  seller: string;
  quotaAsset: string;
  totalQuotas: number;
  minPricePerQuota: bigint;
  closeLedger: number;
  graceLedgers: number;
  finalizeByLedger: number;
  status: MarketStatus;
  bidCount: number;
  unsold: number | null;
  contractsVersion: string | null;
  supported: boolean;
  nextCheckLedger: number | null;
  backoffAttempts: number;
  lastSyncedLedger: number | null;
  discoveredAt: string;
  terminalAt: string | null;
}

export interface BidRow {
  marketId: bigint;
  bidIndex: number;
  bidder: string;
  participantId: number;
  requestedQuantity: number;
  filledQuantity: number;
  status: BidStatus;
  delegationLive: boolean | null;
  quarantined: boolean;
}

export type ActionOutcome = "ok" | "already_settled" | "retry" | "failed" | "quarantined";

export interface ActionRow {
  id: number;
  marketId: bigint;
  kind: string;
  bidIndex: number | null;
  ledger: number;
  outcome: ActionOutcome;
  code: string | null;
  txHash: string | null;
  feeCharged: bigint | null;
  cpuInsns: number | null;
  at: string;
}

export type Severity = "info" | "warning" | "critical";

export interface AlertRow {
  id: number;
  severity: Severity;
  kind: string;
  marketId: bigint | null;
  bidIndex: number | null;
  message: string;
  dedupKey: string;
  at: string;
  ackedAt: string | null;
}

export interface KeyRow {
  name: string;
  public: string;
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  createdAt: string;
}

const now = (): string => new Date().toISOString();

interface RawMarket {
  market_id: string;
  address: string;
  seller: string;
  quota_asset: string;
  total_quotas: number;
  min_price_per_quota: string;
  close_ledger: number;
  grace_ledgers: number;
  finalize_by_ledger: number;
  status: MarketStatus;
  bid_count: number;
  unsold: number | null;
  contracts_version: string | null;
  supported: number;
  next_check_ledger: number | null;
  backoff_attempts: number;
  last_synced_ledger: number | null;
  discovered_at: string;
  terminal_at: string | null;
}

function toMarket(r: RawMarket): MarketRow {
  return {
    marketId: BigInt(r.market_id),
    address: r.address,
    seller: r.seller,
    quotaAsset: r.quota_asset,
    totalQuotas: r.total_quotas,
    minPricePerQuota: BigInt(r.min_price_per_quota),
    closeLedger: r.close_ledger,
    graceLedgers: r.grace_ledgers,
    finalizeByLedger: r.finalize_by_ledger,
    status: r.status,
    bidCount: r.bid_count,
    unsold: r.unsold,
    contractsVersion: r.contracts_version,
    supported: r.supported === 1,
    nextCheckLedger: r.next_check_ledger,
    backoffAttempts: r.backoff_attempts,
    lastSyncedLedger: r.last_synced_ledger,
    discoveredAt: r.discovered_at,
    terminalAt: r.terminal_at,
  };
}

export const TERMINAL: readonly MarketStatus[] = ["Settled", "Cancelled"];

export class MarketRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  insert(m: Omit<MarketRow, "discoveredAt" | "terminalAt" | "backoffAttempts" | "lastSyncedLedger" | "unsold">): void {
    this.#db
      .prepare(
        `INSERT OR IGNORE INTO markets (market_id, address, seller, quota_asset, total_quotas, min_price_per_quota, close_ledger,
           grace_ledgers, finalize_by_ledger, status, bid_count, contracts_version, supported, next_check_ledger, discovered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.marketId.toString(),
        m.address,
        m.seller,
        m.quotaAsset,
        m.totalQuotas,
        m.minPricePerQuota.toString(),
        m.closeLedger,
        m.graceLedgers,
        m.finalizeByLedger,
        m.status,
        m.bidCount,
        m.contractsVersion,
        m.supported ? 1 : 0,
        m.nextCheckLedger,
        now(),
      );
  }

  get(marketId: bigint): MarketRow | null {
    const r = this.#db.prepare("SELECT * FROM markets WHERE market_id = ?").get(marketId.toString()) as RawMarket | undefined;
    return r === undefined ? null : toMarket(r);
  }

  byAddress(address: string): MarketRow | null {
    const r = this.#db.prepare("SELECT * FROM markets WHERE address = ?").get(address) as RawMarket | undefined;
    return r === undefined ? null : toMarket(r);
  }

  list(q: { status?: readonly MarketStatus[]; supported?: boolean; after?: bigint; limit: number }): MarketRow[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.status !== undefined && q.status.length > 0) {
      where.push(`status IN (${q.status.map(() => "?").join(",")})`);
      args.push(...q.status);
    }
    if (q.supported !== undefined) {
      where.push("supported = ?");
      args.push(q.supported ? 1 : 0);
    }
    if (q.after !== undefined) {
      where.push("CAST(market_id AS INTEGER) > CAST(? AS INTEGER)");
      args.push(q.after.toString());
    }
    const sql = `SELECT * FROM markets ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY CAST(market_id AS INTEGER) LIMIT ?`;
    return (this.#db.prepare(sql).all(...args, q.limit) as RawMarket[]).map(toMarket);
  }

  due(ledger: number): MarketRow[] {
    return (this.#db.prepare("SELECT * FROM markets WHERE next_check_ledger IS NOT NULL AND next_check_ledger <= ?").all(ledger) as RawMarket[]).map(toMarket);
  }

  makeAllDue(ledger: number): number {
    return this.#db.prepare("UPDATE markets SET next_check_ledger = ? WHERE next_check_ledger IS NOT NULL").run(ledger).changes;
  }

  setNextCheck(marketId: bigint, nextCheckLedger: number | null, backoffAttempts: number): void {
    this.#db
      .prepare("UPDATE markets SET next_check_ledger = ?, backoff_attempts = ? WHERE market_id = ?")
      .run(nextCheckLedger, backoffAttempts, marketId.toString());
  }

  updateState(marketId: bigint, s: { status: MarketStatus; bidCount: number; finalizeByLedger: number; unsold: number | null; ledger: number }): void {
    const terminal = TERMINAL.includes(s.status);
    this.#db
      .prepare(
        `UPDATE markets SET status = ?, bid_count = ?, finalize_by_ledger = ?, unsold = COALESCE(?, unsold), last_synced_ledger = ?,
           terminal_at = CASE WHEN ? AND terminal_at IS NULL THEN ? ELSE terminal_at END
         WHERE market_id = ?`,
      )
      .run(s.status, s.bidCount, s.finalizeByLedger, s.unsold, s.ledger, terminal ? 1 : 0, now(), marketId.toString());
  }

  countByStatus(): Record<string, number> {
    const rows = this.#db.prepare("SELECT status, COUNT(*) AS n FROM markets GROUP BY status").all() as { status: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }
}

interface RawBid {
  market_id: string;
  bid_index: number;
  bidder: string;
  participant_id: number;
  requested_quantity: number;
  filled_quantity: number;
  status: BidStatus;
  delegation_live: number | null;
  quarantined: number;
}

export class BidRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  upsert(b: Omit<BidRow, "quarantined">): void {
    this.#db
      .prepare(
        `INSERT INTO bids (market_id, bid_index, bidder, participant_id, requested_quantity, filled_quantity, status, delegation_live)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (market_id, bid_index) DO UPDATE SET filled_quantity = excluded.filled_quantity, status = excluded.status,
           delegation_live = excluded.delegation_live`,
      )
      .run(b.marketId.toString(), b.bidIndex, b.bidder, b.participantId, b.requestedQuantity, b.filledQuantity, b.status, b.delegationLive === null ? null : b.delegationLive ? 1 : 0);
  }

  setQuarantined(marketId: bigint, bidIndex: number, quarantined: boolean): void {
    this.#db.prepare("UPDATE bids SET quarantined = ? WHERE market_id = ? AND bid_index = ?").run(quarantined ? 1 : 0, marketId.toString(), bidIndex);
  }

  clearQuarantine(): void {
    this.#db.prepare("UPDATE bids SET quarantined = 0").run();
  }

  forMarket(marketId: bigint): BidRow[] {
    const rows = this.#db.prepare("SELECT * FROM bids WHERE market_id = ? ORDER BY bid_index").all(marketId.toString()) as RawBid[];
    return rows.map((r) => ({
      marketId: BigInt(r.market_id),
      bidIndex: r.bid_index,
      bidder: r.bidder,
      participantId: r.participant_id,
      requestedQuantity: r.requested_quantity,
      filledQuantity: r.filled_quantity,
      status: r.status,
      delegationLive: r.delegation_live === null ? null : r.delegation_live === 1,
      quarantined: r.quarantined === 1,
    }));
  }
}

interface RawAction {
  id: number;
  market_id: string;
  kind: string;
  bid_index: number | null;
  ledger: number;
  outcome: ActionOutcome;
  code: string | null;
  tx_hash: string | null;
  fee_charged: string | null;
  cpu_insns: number | null;
  at: string;
}

export class ActionRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  insert(a: Omit<ActionRow, "id" | "at">): number {
    return Number(
      this.#db
        .prepare("INSERT INTO actions (market_id, kind, bid_index, ledger, outcome, code, tx_hash, fee_charged, cpu_insns, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(a.marketId.toString(), a.kind, a.bidIndex, a.ledger, a.outcome, a.code, a.txHash, a.feeCharged === null ? null : a.feeCharged.toString(), a.cpuInsns, now())
        .lastInsertRowid,
    );
  }

  forMarket(marketId: bigint, q: { before?: number; limit: number }): ActionRow[] {
    const rows = this.#db
      .prepare(`SELECT * FROM actions WHERE market_id = ? ${q.before === undefined ? "" : "AND id < ?"} ORDER BY id DESC LIMIT ?`)
      .all(...[marketId.toString(), ...(q.before === undefined ? [] : [q.before]), q.limit]) as RawAction[];
    return rows.map((r) => ({
      id: r.id,
      marketId: BigInt(r.market_id),
      kind: r.kind,
      bidIndex: r.bid_index,
      ledger: r.ledger,
      outcome: r.outcome,
      code: r.code,
      txHash: r.tx_hash,
      feeCharged: r.fee_charged === null ? null : BigInt(r.fee_charged),
      cpuInsns: r.cpu_insns,
      at: r.at,
    }));
  }
}

interface RawAlert {
  id: number;
  severity: Severity;
  kind: string;
  market_id: string | null;
  bid_index: number | null;
  message: string;
  dedup_key: string;
  at: string;
  acked_at: string | null;
}

export class AlertRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  open(a: Omit<AlertRow, "id" | "at" | "ackedAt">): boolean {
    const r = this.#db
      .prepare("INSERT OR IGNORE INTO alerts (severity, kind, market_id, bid_index, message, dedup_key, at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(a.severity, a.kind, a.marketId === null ? null : a.marketId.toString(), a.bidIndex, a.message, a.dedupKey, now());
    return r.changes > 0;
  }

  ack(id: number): boolean {
    return this.#db.prepare("UPDATE alerts SET acked_at = ? WHERE id = ? AND acked_at IS NULL").run(now(), id).changes > 0;
  }

  list(q: { open?: boolean; severity?: Severity; before?: number; limit: number }): AlertRow[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (q.open === true) where.push("acked_at IS NULL");
    if (q.open === false) where.push("acked_at IS NOT NULL");
    if (q.severity !== undefined) {
      where.push("severity = ?");
      args.push(q.severity);
    }
    if (q.before !== undefined) {
      where.push("id < ?");
      args.push(q.before);
    }
    const rows = this.#db
      .prepare(`SELECT * FROM alerts ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`)
      .all(...args, q.limit) as RawAlert[];
    return rows.map((r) => ({
      id: r.id,
      severity: r.severity,
      kind: r.kind,
      marketId: r.market_id === null ? null : BigInt(r.market_id),
      bidIndex: r.bid_index,
      message: r.message,
      dedupKey: r.dedup_key,
      at: r.at,
      ackedAt: r.acked_at,
    }));
  }

  countOpen(): number {
    return (this.#db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE acked_at IS NULL").get() as { n: number }).n;
  }
}

export class KeyRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  get(name: string): KeyRow | null {
    const r = this.#db.prepare("SELECT * FROM keys WHERE name = ?").get(name) as
      | { name: string; public: string; ciphertext: Buffer; iv: Buffer; tag: Buffer; created_at: string }
      | undefined;
    return r === undefined ? null : { name: r.name, public: r.public, ciphertext: r.ciphertext, iv: r.iv, tag: r.tag, createdAt: r.created_at };
  }

  insert(k: Omit<KeyRow, "createdAt">): boolean {
    return this.#db
      .prepare("INSERT OR IGNORE INTO keys (name, public, ciphertext, iv, tag, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(k.name, k.public, k.ciphertext, k.iv, k.tag, now()).changes > 0;
  }

  list(): { name: string; public: string; createdAt: string }[] {
    return (this.#db.prepare("SELECT name, public, created_at FROM keys ORDER BY name").all() as { name: string; public: string; created_at: string }[]).map((r) => ({
      name: r.name,
      public: r.public,
      createdAt: r.created_at,
    }));
  }
}

export class MetaRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  get(key: string): string | null {
    const r = this.#db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }

  set(key: string, value: string): void {
    this.#db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  delete(key: string): void {
    this.#db.prepare("DELETE FROM meta WHERE key = ?").run(key);
  }

  transaction<T>(fn: () => T): T {
    return this.#db.transaction(fn)();
  }
}

export interface Repos {
  markets: MarketRepo;
  bids: BidRepo;
  actions: ActionRepo;
  alerts: AlertRepo;
  keys: KeyRepo;
  meta: MetaRepo;
}

export function repos(db: Db): Repos {
  return { markets: new MarketRepo(db), bids: new BidRepo(db), actions: new ActionRepo(db), alerts: new AlertRepo(db), keys: new KeyRepo(db), meta: new MetaRepo(db) };
}
