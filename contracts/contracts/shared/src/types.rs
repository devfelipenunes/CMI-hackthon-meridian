use soroban_sdk::{contracttype, Address, Bytes, BytesN};

pub const MAX_BIDS: u32 = 8;
pub const FEE_BPS: u32 = 1_000;
pub const AUCTION_RULE: u32 = 1;
pub const QUOTA_UNIT: i128 = 10_000_000;

pub const SECONDS_PER_LEDGER: u32 = 5;
pub const MAX_DURATION_LEDGERS: u32 = 30 * 24 * 3600 / SECONDS_PER_LEDGER;
pub const FINALIZATION_GRACE_LEDGERS: u32 = 2 * 24 * 3600 / SECONDS_PER_LEDGER;

pub const MIN_FINALIZATION_GRACE_LEDGERS: u32 = 12;
pub const MAX_FINALIZATION_GRACE_LEDGERS: u32 = FINALIZATION_GRACE_LEDGERS;
pub const SETTLEMENT_MARGIN_LEDGERS: u32 = 24 * 3600 / SECONDS_PER_LEDGER;
pub const TTL_BUFFER_LEDGERS: u32 = 24 * 3600 / SECONDS_PER_LEDGER;
pub const REIMBURSEMENT_PER_CALL: i128 = 5_000_000;
pub const MIN_FEE_RESERVE: i128 = (2 + MAX_BIDS as i128) * REIMBURSEMENT_PER_CALL;

pub const BID_COMMIT_DOMAIN: u64 = 1001;
pub const BID_ENVELOPE_MASK_DOMAIN: u64 = 1002;
pub const BID_LEAF_DOMAIN: u64 = 1003;
pub const NULLIFIER_DOMAIN: u64 = 1004;
pub const EMPTY_LEAF: u64 = 999_999;

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum MarketStatus {
    Created,
    Open,
    Closed,
    Finalized,
    Settled,
    Cancelled,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum BidStatus {
    Pending,
    Settled,
    Failed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlatformConfig {
    pub collateral_token: Address,
    pub fee_asset: Address,
    pub bid_verifier: Address,
    pub allocation_verifier: Address,
    pub settlement_verifier: Address,
    pub fee_wallet: Address,
    pub auditor_id: u32,

    pub finalization_grace_ledgers: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketParams {
    pub quota_asset: Address,
    pub total_quotas: u32,
    pub min_price_per_quota: u64,
    pub close_ledger: u32,
    pub eligibility_policy: Option<Address>,
    pub fee_reserve: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketConfig {
    pub market_id: u64,
    pub seller: Address,
    pub params: MarketParams,
    pub platform: PlatformConfig,
    pub finalization_grace_ledgers: u32,
    pub fee_bps: u32,
    pub auction_rule: u32,
    pub max_bids: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BidEnvelope {
    pub r_point: BytesN<64>,
    pub ct_price: BytesN<32>,
    pub ct_blinding: BytesN<32>,
    pub ct_seed: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BidSubmission {
    pub requested_quantity: u32,
    pub commitment: BytesN<32>,
    pub nullifier: BytesN<32>,
    pub envelope: BidEnvelope,
    pub proof: Bytes,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BidRecord {
    pub bidder: Address,
    pub participant_id: u32,
    pub commitment: BytesN<32>,
    pub nullifier: BytesN<32>,
    pub requested_quantity: u32,
    pub envelope: BidEnvelope,
    pub filled_quantity: u32,
    pub status: BidStatus,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum SettleOutcome {
    Settled,
    AlreadySettled,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ConfigError {
    TotalQuotas,
    MinPrice,
    CloseLedger,
    DurationTooLong,
    FeeReserve,
}
