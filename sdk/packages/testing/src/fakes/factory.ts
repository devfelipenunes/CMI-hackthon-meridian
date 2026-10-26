import { StrKey } from "@stellar/stellar-sdk";
import {
  CmiError,
  MAX_DURATION_LEDGERS,
  MIN_FEE_RESERVE,
  PRICE_MAX_EXCLUSIVE,
  type Clock,
  type CmiErrorCode,
  type FactoryPort,
  type MarketParams,
  type PlatformConfig,
  type Signer,
  type TokenPort,
} from "@zolvency-cmi/core";

import { FAKE_PLATFORM, FakeAuction, type FakeAuctionOptions } from "./auction.js";
import { contractError, type CallLog } from "./log.js";

export class FakeFactory implements FactoryPort {
  readonly address = StrKey.encodeContract(Buffer.alloc(32, 100));
  readonly #log: CallLog;
  readonly #clock: Clock;
  readonly #auctionOpts: Partial<FakeAuctionOptions>;
  readonly #markets = new Map<bigint, FakeAuction>();
  #next = 1n;
  #failures: { left: number; code: CmiErrorCode } | null = null;

  constructor(o: { log: CallLog; clock: Clock; token?: TokenPort; auction?: Partial<FakeAuctionOptions> }) {
    this.#log = o.log;
    this.#clock = o.clock;
    this.#auctionOpts = { ...(o.token === undefined ? {} : { token: o.token }), ...o.auction };
  }

  failCreate(n: number, code: CmiErrorCode): void {
    this.#failures = { left: n, code };
  }

  auction(address: string): FakeAuction {
    const a = [...this.#markets.values()].find((m) => m.address === address);
    if (a === undefined) throw new Error(`FakeFactory: no market at ${address}`);
    return a;
  }

  #predict(id: bigint): string {
    const seed = Buffer.alloc(32);
    seed.writeBigUInt64BE(id, 24);
    seed[0] = 0xa0;
    return StrKey.encodeContract(seed);
  }

  async nextMarketId(): Promise<bigint> {
    this.#log.record("factory.next_market_id", false);
    return this.#next;
  }

  async predictMarketAddress(id: bigint): Promise<string> {
    this.#log.record("factory.predict_market_address", false, [id]);
    return this.#predict(id);
  }

  async getMarketAddress(id: bigint): Promise<string> {
    this.#log.record("factory.get_market_address", false, [id]);
    const a = this.#markets.get(id);
    if (a === undefined) throw new CmiError("Factory.MarketNotFound", "unknown market_id");
    return a.address;
  }

  async getPlatformConfig(): Promise<PlatformConfig> {
    this.#log.record("factory.get_platform_config", false);
    return FAKE_PLATFORM;
  }

  async createMarket(seller: Signer, params: MarketParams, registerData: Uint8Array): Promise<{ marketId: bigint; address: string }> {
    this.#log.record("factory.create_market", true, [seller.address, params, registerData]);
    const ledger = await this.#clock.ledger();
    const reject = (code: CmiErrorCode): never => {
      throw contractError(code, "create_market rejected");
    };
    if (params.totalQuotas === 0) reject("Factory.InvalidTotalQuotas");
    if (params.minPricePerQuota === 0n || params.minPricePerQuota >= PRICE_MAX_EXCLUSIVE) reject("Factory.InvalidMinPrice");
    if (params.closeLedger <= ledger) reject("Factory.InvalidCloseLedger");
    if (params.closeLedger - ledger > MAX_DURATION_LEDGERS) reject("Factory.DurationTooLong");
    if (params.feeReserve < MIN_FEE_RESERVE) reject("Factory.InvalidFeeReserve");
    if (this.#failures !== null && this.#failures.left > 0) {
      this.#failures.left -= 1;
      reject(this.#failures.code);
    }
    const marketId = this.#next++;
    const address = this.#predict(marketId);
    this.#markets.set(
      marketId,
      new FakeAuction({ ...this.#auctionOpts, log: this.#log, clock: this.#clock, params, seller: seller.address, address, marketId }),
    );
    return { marketId, address };
  }
}
