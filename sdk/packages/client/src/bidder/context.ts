import type {
  AuctionPort,
  Clock,
  ContractId,
  FactoryPort,
  Logger,
  Point,
  Prover,
  QuotaPort,
  Rng,
  Signer,
  TokenPort,
} from "@zolvency-cmi/core";

import type { OpeningStore } from "../account/openings.js";
import type { ConfidentialKeyProvider } from "../keys/provider.js";

export interface BidderContext {

  signer: Signer;
  factory: FactoryPort;
  auction(address: ContractId): AuctionPort;
  token: TokenPort;
  quota: QuotaPort;
  clock: Clock;
  prover: Prover;
  keys: ConfidentialKeyProvider;

  tokenAddress: ContractId;
  openings: OpeningStore;
  rng?: Rng;
  logger?: Logger;

  pkOperator?: Point;
}
