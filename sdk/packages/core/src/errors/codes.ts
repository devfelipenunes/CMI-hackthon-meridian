

export const AUCTION_ERRORS = {
  1: "InvalidTotalQuotas",
  2: "InvalidMinPrice",
  3: "InvalidCloseLedger",
  4: "DurationTooLong",
  5: "InvalidFeeReserve",
  10: "InvalidState",
  11: "TooEarly",
  12: "TooLate",
  13: "BiddingClosed",
  14: "HasBids",
  20: "AlreadyRegistered",
  21: "NotRegistered",
  22: "NotEligible",
  30: "MarketFull",
  31: "AlreadyBid",
  32: "ZeroQuantity",
  33: "NullifierUsed",
  34: "NoTrustline",
  35: "NoCollateral",
  36: "CollateralExpiresTooSoon",
  37: "InvalidBidProof",
  40: "InvalidAllocationLength",
  41: "FillExceedsRequest",
  42: "InvalidAllocationProof",
  50: "BidNotFound",
  51: "InvalidTransferData",
  52: "InvalidSettlementProof",
  53: "DelegationStillActive",
  54: "BidAlreadyClosed",
} as const;

export const FACTORY_ERRORS = {
  1: "MarketNotFound",
  2: "MarketIdOverflow",
  3: "InvalidTotalQuotas",
  4: "InvalidMinPrice",
  5: "InvalidCloseLedger",
  6: "DurationTooLong",
  7: "InvalidFeeReserve",
  8: "SellerNotRegistered",
  9: "FeeWalletNotRegistered",
  10: "InvalidFinalizationGrace",
} as const;

export const TOKEN_ERRORS = {
  3500: "AccountAlreadyRegistered",
  3501: "AccountNotRegistered",
  3502: "NegativeAmount",
  3503: "DelegationAlreadyExists",
  3504: "DelegationNotFound",
  3505: "DelegationExpired",
  3506: "InvalidProof",
  3507: "InvalidData",
  3508: "UnderlyingAssetNotSet",
  3509: "VerifierNotSet",
  3510: "AuditorNotSet",
  3511: "AddressAsFieldNotSet",
  3512: "AddressAsFieldAlreadySet",
  3513: "UnderlyingAssetAlreadySet",
  3514: "NonCanonicalEncoding",
} as const;

export type AuctionErrorName = (typeof AUCTION_ERRORS)[keyof typeof AUCTION_ERRORS];
export type FactoryErrorName = (typeof FACTORY_ERRORS)[keyof typeof FACTORY_ERRORS];
export type TokenErrorName = (typeof TOKEN_ERRORS)[keyof typeof TOKEN_ERRORS];

export type LocalErrorCode =
  | "ProofFailed"
  | "ArtifactNotFound"
  | "ArtifactMismatch"
  | "KeyAlreadyExists"
  | "KeyNotFound"
  | "InvalidBackup"
  | "NetworkMismatch"
  | "ResourceContention"
  | "TxFailed"
  | "PriceOutOfRange"
  | "BelowMinPrice"
  | "MarketNotOpen"
  | "BiddingClosed"
  | "MarketFull"
  | "AlreadyBid"
  | "NoTrustline"
  | "InsufficientBalance"
  | "BalanceOutOfSync"
  | "CollateralMismatch"
  | "OpeningMismatch"
  | "RootMismatch"
  | "UnsupportedContractsVersion";

export type CmiErrorCode =
  | LocalErrorCode
  | `Auction.${AuctionErrorName}`
  | `Factory.${FactoryErrorName}`
  | `Token.${TokenErrorName}`;
