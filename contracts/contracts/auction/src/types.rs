pub use shared::types::*;

use soroban_sdk::{contracterror, contracttype, Address, BytesN};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    State,

    Config,

    ConfigHash,

    FeeReserve,

    Bids,

    ParticipantCount,

    ParticipantId(Address),

    ParticipantAddr(u32),

    Nullifier(BytesN<32>),

    Root,

    FinalizeBy,

    OpenBids,
}

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum AuctionError {
    InvalidTotalQuotas = 1,

    InvalidMinPrice = 2,

    InvalidCloseLedger = 3,

    DurationTooLong = 4,

    InvalidFeeReserve = 5,

    InvalidState = 10,

    TooEarly = 11,

    TooLate = 12,

    BiddingClosed = 13,

    HasBids = 14,

    AlreadyRegistered = 20,

    NotRegistered = 21,

    NotEligible = 22,

    MarketFull = 30,

    AlreadyBid = 31,

    ZeroQuantity = 32,

    NullifierUsed = 33,

    NoTrustline = 34,

    NoCollateral = 35,

    CollateralExpiresTooSoon = 36,

    InvalidBidProof = 37,

    InvalidAllocationLength = 40,

    FillExceedsRequest = 41,

    InvalidAllocationProof = 42,

    BidNotFound = 50,

    InvalidTransferData = 51,

    InvalidSettlementProof = 52,

    DelegationStillActive = 53,

    BidAlreadyClosed = 54,
}
