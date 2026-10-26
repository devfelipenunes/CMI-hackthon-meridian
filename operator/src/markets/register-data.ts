import type { FactoryPort } from "@zolvency-cmi/core";
import type { CmiOperator } from "@zolvency-cmi/operator";

import type { MetaRepo } from "../db/repos.js";

export interface RegisterDataView {
  marketId: bigint;
  address: string;
  registerData: Uint8Array;
}

export class RegisterDataProvider {
  readonly #operator: CmiOperator;
  readonly #factory: FactoryPort;
  readonly #meta: MetaRepo;
  readonly #cacheKey: string;
  #pending: Promise<Uint8Array> | null = null;

  constructor(o: { operator: CmiOperator; factory: FactoryPort; meta: MetaRepo; spenderPublic: string; tokenAddress: string }) {
    this.#operator = o.operator;
    this.#factory = o.factory;
    this.#meta = o.meta;
    this.#cacheKey = `register_data:${o.spenderPublic}:${o.tokenAddress}`;
  }

  async forNextMarket(): Promise<RegisterDataView> {
    const cached = this.#meta.get(this.#cacheKey);
    if (cached !== null) {
      const marketId = await this.#factory.nextMarketId();
      return { marketId, address: await this.#factory.predictMarketAddress(marketId), registerData: new Uint8Array(Buffer.from(cached, "base64")) };
    }

    this.#pending ??= this.#operator.registerDataForNextMarket().then((r) => {
      this.#meta.set(this.#cacheKey, Buffer.from(r.registerData).toString("base64"));
      return r.registerData;
    });
    try {
      const registerData = await this.#pending;
      const marketId = await this.#factory.nextMarketId();
      return { marketId, address: await this.#factory.predictMarketAddress(marketId), registerData };
    } finally {
      this.#pending = null;
    }
  }
}
