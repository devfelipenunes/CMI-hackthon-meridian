import { silentLogger, type AuctionPort, type ContractId, type FactoryPort, type Logger, type Prover, type Signer, type TokenPort } from "@zolvency-cmi/core";

import { planAllocation, proveAllocation, type AllocationPlan } from "./allocation.js";
import { readBids, type DecryptedBid } from "./envelopes.js";
import type { MarketSnapshot } from "./keeper/planner.js";
import { buildSettlement, type SettlementPayload } from "./settlement.js";

import type { OperatorKeyStore } from "./keystore.js";
import { buildRegisterData } from "./register.js";

export interface CmiOperatorConfig {
  keys: OperatorKeyStore;
  factory: FactoryPort;

  tokenAddress: string;
  prover: Prover;
  logger?: Logger;

  auction?: (address: ContractId) => AuctionPort;

  token?: TokenPort;
}

export class CmiOperator {
  readonly #cfg: CmiOperatorConfig;
  readonly #log: Logger;
  #registerData: Promise<Uint8Array> | undefined;

  constructor(cfg: CmiOperatorConfig) {
    this.#cfg = cfg;
    this.#log = cfg.logger ?? silentLogger;
  }

  async registerDataForNextMarket(): Promise<{ marketId: bigint; address: string; registerData: Uint8Array }> {
    const { factory } = this.#cfg;
    const marketId = await factory.nextMarketId();
    const address = await factory.predictMarketAddress(marketId);
    this.#registerData ??= this.#cfg.keys.spenderKey().then((spenderKey) => buildRegisterData({ spenderKey, tokenAddress: this.#cfg.tokenAddress, prover: this.#cfg.prover }));
    this.#registerData.catch(() => {
      this.#registerData = undefined;
    });
    const registerData = await this.#registerData;
    this.#log.info("register_data ready", { marketId: marketId.toString(), address });
    return { marketId, address, registerData };
  }

  async readBids(auction: ContractId): Promise<DecryptedBid[]> {
    const { keys, tokenAddress } = this.#cfg;
    return readBids({
      auction: this.#ports().auction(auction),
      token: this.#ports().token,
      tokenAddress,
      spenderKey: await keys.spenderKey(),
      envelopeKey: await keys.envelopeKey(),
      logger: this.#log,
    });
  }

  async planAllocation(auction: ContractId): Promise<AllocationPlan> {
    return planAllocation(this.#ports().auction(auction), await this.readBids(auction));
  }

  async proveAllocation(plan: AllocationPlan): Promise<{ filled: number[]; proof: Uint8Array }> {
    return proveAllocation(this.#cfg.prover, plan);
  }

  async buildSettlement(auction: ContractId, bidIndex: number): Promise<SettlementPayload> {
    const { keys, tokenAddress, prover } = this.#cfg;
    const ports = this.#ports();
    return buildSettlement({
      auction: ports.auction(auction),
      token: ports.token,
      tokenAddress,
      spenderKey: await keys.spenderKey(),
      envelopeKey: await keys.envelopeKey(),
      prover,
      bidIndex,
      logger: this.#log,
    });
  }

  async snapshot(auction: ContractId): Promise<MarketSnapshot> {
    const { token } = this.#ports();
    const a = this.auctionPort(auction);
    const state = await a.getState();
    const market = await a.getMarket();
    const finalizeByLedger = await a.getFinalizeByLedger();
    const count = await a.getBidCount();
    const bids: MarketSnapshot["bids"] = [];
    for (let i = 0; i < count; i++) {
      const r = await a.getBidRecord(i);
      bids.push({ status: r.status, delegationLive: r.status === "Pending" && (await token.isSpender(r.bidder, auction)) });
    }
    return { state, closeLedger: market.params.closeLedger, finalizeByLedger, bids };
  }

  auctionPort(auction: ContractId): AuctionPort {
    return this.#ports().auction(auction);
  }

  submitter(): Promise<Signer> {
    return this.#cfg.keys.submitter();
  }

  #ports(): { auction: (address: ContractId) => AuctionPort; token: TokenPort } {
    const { auction, token } = this.#cfg;
    if (auction === undefined || token === undefined) throw new TypeError("CmiOperator: this flow needs the auction and token ports in the config");
    return { auction, token };
  }
}
