import {
  chainAuctionPort,
  chainFactoryPort,
  chainQuotaPort,
  chainTokenPort,
  type AuctionPort,
  type ChainClient,
  type ContractId,
  type FactoryPort,
  type Logger,
  type Point,
  type Prover,
  type Rng,
  type Signer,
  type TokenPort,
} from "@zolvency-cmi/core";

import { AccountApi } from "./account/index.js";
import { MemoryOpeningStore, type OpeningStore } from "./account/openings.js";
import { BidderApi } from "./bidder/index.js";
import type { BidderContext } from "./bidder/context.js";
import type { ConfidentialKeyProvider } from "./keys/provider.js";
import { MarketsApi } from "./markets/index.js";
import { SellerApi } from "./seller/index.js";

export type ClientContext = BidderContext;

export class CmiClient {
  readonly account: AccountApi;
  readonly bidder: BidderApi;
  readonly seller: SellerApi;
  readonly markets: MarketsApi;
  readonly factory: FactoryPort;
  readonly token: TokenPort;
  readonly #ctx: ClientContext;

  constructor(ctx: ClientContext) {
    this.#ctx = ctx;
    this.account = new AccountApi(ctx);
    this.bidder = new BidderApi(ctx);
    this.seller = new SellerApi(ctx);
    this.markets = new MarketsApi(ctx);
    this.factory = ctx.factory;
    this.token = ctx.token;
  }

  auctionAt(address: ContractId): AuctionPort {
    return this.#ctx.auction(address);
  }
}

export function connectClient(o: {
  chain: ChainClient;
  contracts: { factory: ContractId; token: ContractId; auditor: ContractId };
  signer: Signer;
  keys: ConfidentialKeyProvider;
  prover: Prover;
  openings?: OpeningStore;
  rng?: Rng;
  logger?: Logger;
  pkOperator?: Point;
}): CmiClient {
  const { chain, contracts } = o;
  return new CmiClient({
    signer: o.signer,
    factory: chainFactoryPort({ chain, address: contracts.factory }),
    auction: (address) => chainAuctionPort({ chain, address }),
    token: chainTokenPort({ chain, token: contracts.token, auditor: contracts.auditor }),
    quota: chainQuotaPort({ chain }),
    clock: { ledger: () => chain.latestLedger() },
    prover: o.prover,
    keys: o.keys,
    tokenAddress: contracts.token,
    openings: o.openings ?? new MemoryOpeningStore(),
    ...(o.rng === undefined ? {} : { rng: o.rng }),
    ...(o.logger === undefined ? {} : { logger: o.logger }),
    ...(o.pkOperator === undefined ? {} : { pkOperator: o.pkOperator }),
  });
}
