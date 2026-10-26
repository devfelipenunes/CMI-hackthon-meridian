use soroban_sdk::token::TokenClient;
use soroban_sdk::{contractevent, panic_with_error, Address, Bytes, BytesN, Env, Symbol, Vec};

use crate::bidding;
use crate::crypto::{self, config_hash};
use crate::external;
use crate::types::{
    AuctionError, ConfigError, DataKey, MarketConfig, MarketParams, MarketStatus, PlatformConfig,
    AUCTION_RULE, FEE_BPS, MAX_BIDS, QUOTA_UNIT, REIMBURSEMENT_PER_CALL, SETTLEMENT_MARGIN_LEDGERS,
    TTL_BUFFER_LEDGERS,
};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketOpened {
    #[topic]
    pub market_id: u64,
    pub config_hash: BytesN<32>,
    pub total_quotas: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketCancelled {
    #[topic]
    pub market_id: u64,
    pub reason: Symbol,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketClosed {
    #[topic]
    pub market_id: u64,
    pub bid_count: u32,
    pub commitments_root: BytesN<32>,
    pub finalize_by_ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketFinalized {
    #[topic]
    pub market_id: u64,
    pub filled_quantities: Vec<u32>,
    pub unsold: u32,
}

pub(crate) fn config_error(err: ConfigError) -> AuctionError {
    match err {
        ConfigError::TotalQuotas => AuctionError::InvalidTotalQuotas,
        ConfigError::MinPrice => AuctionError::InvalidMinPrice,
        ConfigError::CloseLedger => AuctionError::InvalidCloseLedger,
        ConfigError::DurationTooLong => AuctionError::DurationTooLong,
        ConfigError::FeeReserve => AuctionError::InvalidFeeReserve,
    }
}

pub(crate) fn read_config(e: &Env) -> MarketConfig {
    e.storage()
        .instance()
        .get(&DataKey::Config)
        .unwrap_or_else(|| panic_with_error!(e, AuctionError::InvalidState))
}

pub(crate) fn write_config(e: &Env, config: &MarketConfig) {
    e.storage().instance().set(&DataKey::Config, config);
    extend_instance_ttl(e);
}

pub(crate) fn read_config_hash(e: &Env) -> Option<BytesN<32>> {
    e.storage().instance().get(&DataKey::ConfigHash)
}

pub(crate) fn read_open_config_hash(e: &Env) -> BytesN<32> {
    read_config_hash(e).unwrap_or_else(|| panic_with_error!(e, AuctionError::InvalidState))
}

pub(crate) fn write_config_hash(e: &Env, hash: &BytesN<32>) {
    e.storage().instance().set(&DataKey::ConfigHash, hash);
    extend_instance_ttl(e);
}

pub(crate) fn read_fee_reserve(e: &Env) -> i128 {
    e.storage()
        .instance()
        .get(&DataKey::FeeReserve)
        .unwrap_or_else(|| panic_with_error!(e, AuctionError::InvalidState))
}

pub(crate) fn write_fee_reserve(e: &Env, reserve: i128) {
    e.storage().instance().set(&DataKey::FeeReserve, &reserve);
    extend_instance_ttl(e);
}

pub(crate) fn reimburse(e: &Env, caller: &Address) {
    let config = read_config(e);

    TokenClient::new(e, &config.platform.fee_asset).transfer(
        &e.current_contract_address(),
        caller,
        &REIMBURSEMENT_PER_CALL,
    );

    write_fee_reserve(e, read_fee_reserve(e) - REIMBURSEMENT_PER_CALL);
}

pub(crate) fn read_root(e: &Env) -> Option<BytesN<32>> {
    e.storage().instance().get(&DataKey::Root)
}

pub(crate) fn write_root(e: &Env, root: &BytesN<32>) {
    e.storage().instance().set(&DataKey::Root, root);
    extend_instance_ttl(e);
}

pub(crate) fn read_finalize_by(e: &Env) -> Option<u32> {
    e.storage().instance().get(&DataKey::FinalizeBy)
}

pub(crate) fn write_finalize_by(e: &Env, ledger: u32) {
    e.storage().instance().set(&DataKey::FinalizeBy, &ledger);
    extend_instance_ttl(e);
}

pub(crate) fn write_open_bids(e: &Env, count: u32) {
    e.storage().instance().set(&DataKey::OpenBids, &count);
    extend_instance_ttl(e);
}

pub(crate) fn read_open_bids(e: &Env) -> Option<u32> {
    e.storage().instance().get(&DataKey::OpenBids)
}

fn is_legal(from: MarketStatus, to: MarketStatus) -> bool {
    matches!(
        (from, to),
        (MarketStatus::Created, MarketStatus::Open)
            | (MarketStatus::Created, MarketStatus::Cancelled)
            | (MarketStatus::Open, MarketStatus::Closed)
            | (MarketStatus::Open, MarketStatus::Cancelled)
            | (MarketStatus::Closed, MarketStatus::Finalized)
            | (MarketStatus::Closed, MarketStatus::Cancelled)
            | (MarketStatus::Finalized, MarketStatus::Settled)
    )
}

pub(crate) fn read_state(e: &Env) -> MarketStatus {
    e.storage()
        .instance()
        .get(&DataKey::State)
        .unwrap_or_else(|| panic_with_error!(e, AuctionError::InvalidState))
}

pub(crate) fn transition(e: &Env, to: MarketStatus) {
    let from = read_state(e);

    if !is_legal(from, to) {
        panic_with_error!(e, AuctionError::InvalidState);
    }

    e.storage().instance().set(&DataKey::State, &to);
    extend_instance_ttl(e);
}

pub(crate) fn last_transition_ledger(config: &MarketConfig) -> u32 {
    config.params.close_ledger + config.finalization_grace_ledgers + SETTLEMENT_MARGIN_LEDGERS
}

fn required_ttl(e: &Env) -> u32 {
    let last = last_transition_ledger(&read_config(e));
    (last + TTL_BUFFER_LEDGERS)
        .saturating_sub(e.ledger().sequence())
        .max(TTL_BUFFER_LEDGERS)
}

pub(crate) fn extend_instance_ttl(e: &Env) {
    let ttl = required_ttl(e);
    e.storage().instance().extend_ttl(ttl, ttl);
}

pub(crate) fn extend_persistent_ttl(e: &Env, key: &DataKey) {
    let ttl = required_ttl(e);
    e.storage().persistent().extend_ttl(key, ttl, ttl);
}

pub(crate) fn init_state(e: &Env) {
    e.storage()
        .instance()
        .set(&DataKey::State, &MarketStatus::Created);
    extend_instance_ttl(e);
}

pub(crate) fn init(
    e: &Env,
    market_id: u64,
    seller: Address,
    params: MarketParams,
    platform: PlatformConfig,
    register_data: &Bytes,
) {
    if let Err(err) = shared::config::validate_params(e, &params) {
        panic_with_error!(e, config_error(err));
    }

    let finalization_grace_ledgers = platform.finalization_grace_ledgers;
    let config = MarketConfig {
        market_id,
        seller,
        params,
        platform,

        finalization_grace_ledgers,
        fee_bps: FEE_BPS,
        auction_rule: AUCTION_RULE,
        max_bids: MAX_BIDS,
    };

    write_config(e, &config);
    write_fee_reserve(e, config.params.fee_reserve);
    init_state(e);

    external::register(
        e,
        &config.platform.collateral_token,
        config.platform.auditor_id,
        register_data,
    );
}

pub(crate) fn quota_units(quotas: u32) -> i128 {
    quotas as i128 * QUOTA_UNIT
}

fn escrow_amount(config: &MarketConfig) -> i128 {
    quota_units(config.params.total_quotas)
}

pub(crate) fn open(e: &Env) {
    let config = read_config(e);
    config.seller.require_auth();

    transition(e, MarketStatus::Open);

    let escrow = escrow_amount(&config);
    TokenClient::new(e, &config.params.quota_asset).transfer(
        &config.seller,
        e.current_contract_address(),
        &escrow,
    );

    let hash = config_hash(e, &config);
    write_config_hash(e, &hash);

    MarketOpened {
        market_id: config.market_id,
        config_hash: hash,
        total_quotas: config.params.total_quotas,
    }
    .publish(e);
}

pub(crate) fn cancel(e: &Env) {
    let config = read_config(e);
    config.seller.require_auth();

    let from = read_state(e);
    match from {
        MarketStatus::Created => {}
        MarketStatus::Open => {
            if bidding::bid_count(e) > 0 {
                panic_with_error!(e, AuctionError::HasBids);
            }
        }
        _ => panic_with_error!(e, AuctionError::InvalidState),
    }

    transition(e, MarketStatus::Cancelled);

    if from == MarketStatus::Open {
        let escrow = escrow_amount(&config);
        TokenClient::new(e, &config.params.quota_asset).transfer(
            &e.current_contract_address(),
            &config.seller,
            &escrow,
        );
    }

    TokenClient::new(e, &config.platform.fee_asset).transfer(
        &e.current_contract_address(),
        &config.seller,
        &read_fee_reserve(e),
    );

    MarketCancelled {
        market_id: config.market_id,
        reason: Symbol::new(e, "seller"),
    }
    .publish(e);
}

pub(crate) fn close(e: &Env, caller: &Address) {
    if read_state(e) != MarketStatus::Open {
        panic_with_error!(e, AuctionError::InvalidState);
    }

    let config = read_config(e);
    if e.ledger().sequence() < config.params.close_ledger {
        panic_with_error!(e, AuctionError::TooEarly);
    }

    caller.require_auth();

    if bidding::bid_count(e) == 0 {
        transition(e, MarketStatus::Cancelled);

        let escrow = escrow_amount(&config);
        TokenClient::new(e, &config.params.quota_asset).transfer(
            &e.current_contract_address(),
            &config.seller,
            &escrow,
        );

        reimburse(e, caller);
        TokenClient::new(e, &config.platform.fee_asset).transfer(
            &e.current_contract_address(),
            &config.seller,
            &read_fee_reserve(e),
        );
        write_fee_reserve(e, 0);

        MarketCancelled {
            market_id: config.market_id,
            reason: Symbol::new(e, "no_bids"),
        }
        .publish(e);

        return;
    }

    let root = crypto::commitments_root(e, &bidding::commitments(e));
    let finalize_by = config.params.close_ledger + config.finalization_grace_ledgers;

    write_root(e, &root);
    write_finalize_by(e, finalize_by);
    transition(e, MarketStatus::Closed);

    reimburse(e, caller);

    MarketClosed {
        market_id: config.market_id,
        bid_count: bidding::bid_count(e),
        commitments_root: root,
        finalize_by_ledger: finalize_by,
    }
    .publish(e);
}

pub(crate) fn finalize(e: &Env, caller: &Address, filled_quantities: &Vec<u32>, proof: &Bytes) {
    if read_state(e) != MarketStatus::Closed {
        panic_with_error!(e, AuctionError::InvalidState);
    }

    let config = read_config(e);

    let finalize_by =
        read_finalize_by(e).unwrap_or_else(|| panic_with_error!(e, AuctionError::InvalidState));
    if e.ledger().sequence() > finalize_by {
        panic_with_error!(e, AuctionError::TooLate);
    }

    caller.require_auth();

    let bid_count = bidding::bid_count(e);

    if filled_quantities.len() != bid_count {
        panic_with_error!(e, AuctionError::InvalidAllocationLength);
    }

    let requested = bidding::requested_quantities(e);
    let mut total_filled: u64 = 0;
    for (filled, wanted) in filled_quantities.iter().zip(requested.iter()) {
        if filled > wanted {
            panic_with_error!(e, AuctionError::FillExceedsRequest);
        }

        total_filled += filled as u64;
    }
    if total_filled > config.params.total_quotas as u64 {
        panic_with_error!(e, AuctionError::FillExceedsRequest);
    }

    let root = read_root(e).unwrap_or_else(|| panic_with_error!(e, AuctionError::InvalidState));
    let config_hash = read_open_config_hash(e);

    let public_inputs = crypto::allocation_inputs(
        e,
        &crypto::AllocationInputs {
            commitments_root: &root,
            requested_quantities: &requested,
            filled_quantities,
            bid_count,
            total_supply: config.params.total_quotas,
            market_id: config.market_id,
            auction_rule: config.auction_rule,
            config_hash: &config_hash,
        },
    );
    if !external::verify_allocation_proof(
        e,
        &config.platform.allocation_verifier,
        &public_inputs,
        proof,
    ) {
        panic_with_error!(e, AuctionError::InvalidAllocationProof);
    }

    bidding::write_allocation(e, filled_quantities);
    write_open_bids(e, bid_count);
    transition(e, MarketStatus::Finalized);

    let unsold = config.params.total_quotas - total_filled as u32;
    if unsold > 0 {
        TokenClient::new(e, &config.params.quota_asset).transfer(
            &e.current_contract_address(),
            &config.seller,
            &quota_units(unsold),
        );
    }

    reimburse(e, caller);

    MarketFinalized {
        market_id: config.market_id,
        filled_quantities: filled_quantities.clone(),
        unsold,
    }
    .publish(e);
}

pub(crate) fn cancel_expired(e: &Env, caller: &Address) {
    if read_state(e) != MarketStatus::Closed {
        panic_with_error!(e, AuctionError::InvalidState);
    }

    let config = read_config(e);

    let finalize_by =
        read_finalize_by(e).unwrap_or_else(|| panic_with_error!(e, AuctionError::InvalidState));
    if e.ledger().sequence() <= finalize_by {
        panic_with_error!(e, AuctionError::TooEarly);
    }

    caller.require_auth();

    let bid_count = bidding::bid_count(e);
    write_open_bids(e, bid_count);
    transition(e, MarketStatus::Cancelled);

    let escrow = escrow_amount(&config);
    TokenClient::new(e, &config.params.quota_asset).transfer(
        &e.current_contract_address(),
        &config.seller,
        &escrow,
    );

    reimburse(e, caller);

    MarketCancelled {
        market_id: config.market_id,
        reason: Symbol::new(e, "timeout"),
    }
    .publish(e);
}
