

export interface MarketParams {
  quotaAsset: string;
  totalQuotas: number;
  minPricePerQuota: bigint;
  closeLedger: number;
  eligibilityPolicy: string | null;
  feeReserve: bigint;
}

export interface PlatformConfig {
  collateralToken: string;
  feeAsset: string;
  bidVerifier: string;
  allocationVerifier: string;
  settlementVerifier: string;
  feeWallet: string;
  auditorId: number;

  finalizationGraceLedgers: number;
}

export interface MarketConfig {
  marketId: bigint;
  seller: string;
  params: MarketParams;
  platform: PlatformConfig;
  finalizationGraceLedgers: number;
  feeBps: number;
  auctionRule: number;
  maxBids: number;
}
