import type { AccountId, AuctionEvent, AuctionPort, ContractId, FactoryPort, MarketStatus } from "@zolvency-cmi/core";

export type MarketEvent = AuctionEvent;

export interface MarketView {
  marketId: bigint;
  address: ContractId;
  seller: AccountId;
  status: MarketStatus;
  quotaAsset: ContractId;
  totalQuotas: number;
  minPricePerQuota: bigint;
  closeLedger: number;
  finalizeByLedger: number | null;
  bidCount: number;

  demand: number;

  allocation: number[] | null;
}

export interface MarketsContext {
  factory: FactoryPort;
  auction(address: ContractId): AuctionPort;
}

export interface WatchOptions {

  fromLedger: number;

  pollIntervalMs?: number;
  signal?: AbortSignal;
}

function ends(e: MarketEvent): boolean {
  return e.kind === "MarketSettled" || (e.kind === "MarketCancelled" && (e.reason === "seller" || e.reason === "no_bids"));
}

export class MarketsApi {
  readonly #ctx: MarketsContext;

  constructor(ctx: MarketsContext) {
    this.#ctx = ctx;
  }

  async get(marketId: bigint): Promise<MarketView> {
    const address = await this.#ctx.factory.getMarketAddress(marketId);
    const a = this.#ctx.auction(address);
    const market = await a.getMarket();
    const status = await a.getState();
    const bidCount = await a.getBidCount();
    let demand = 0;
    for (let i = 0; i < bidCount; i++) demand += (await a.getBidRecord(i)).requestedQuantity;
    const judged = status === "Finalized" || status === "Settled";
    return {
      marketId,
      address,
      seller: market.seller,
      status,
      quotaAsset: market.params.quotaAsset,
      totalQuotas: market.params.totalQuotas,
      minPricePerQuota: market.params.minPricePerQuota,
      closeLedger: market.params.closeLedger,
      finalizeByLedger: await a.getFinalizeByLedger(),
      bidCount,
      demand,
      allocation: judged ? await a.getAllocation() : null,
    };
  }

  async list(opts: { status?: MarketStatus[] } = {}): Promise<MarketView[]> {
    const next = await this.#ctx.factory.nextMarketId();
    const out: MarketView[] = [];
    for (let id = 1n; id < next; id++) {
      const v = await this.get(id);
      if (opts.status === undefined || opts.status.includes(v.status)) out.push(v);
    }
    return out;
  }

  async *watch(marketId: bigint, opts: WatchOptions): AsyncIterable<MarketEvent> {
    const a = this.#ctx.auction(await this.#ctx.factory.getMarketAddress(marketId));
    const poll = opts.pollIntervalMs ?? 5_000;
    let cursor = opts.fromLedger;
    let seenAtCursor = 0;
    const aborted = (): boolean => opts.signal?.aborted === true;
    while (!aborted()) {
      const events = await a.events({ startLedger: cursor });
      let skip = seenAtCursor;
      for (const e of events) {
        if (e.ledger === cursor && skip > 0) {
          skip -= 1;
          continue;
        }
        if (e.ledger > cursor) {
          cursor = e.ledger;
          seenAtCursor = 0;
        }
        seenAtCursor += 1;
        yield e;
        if (ends(e)) return;
      }
      if (aborted()) return;
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, poll);
        opts.signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
      });
    }
  }
}
