#![no_std]

#[cfg(test)]
extern crate std;

use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, Vec};

use crate::types::{
    BidRecord, BidStatus, BidSubmission, MarketConfig, MarketParams, MarketStatus, PlatformConfig,
    SettleOutcome,
};

pub mod bidding;
pub mod crypto;
pub mod external;
pub mod market;
pub mod settlement;
pub mod types;

pub use bidding::{BidAccepted, ParticipantRegistered};
pub use market::{MarketCancelled, MarketClosed, MarketFinalized, MarketOpened};
pub use settlement::{BidFailed, BidSettled, MarketSettled};

#[contract]
pub struct Auction;

#[contractimpl]
impl Auction {
    pub fn __constructor(
        e: Env,
        market_id: u64,
        seller: Address,
        params: MarketParams,
        platform: PlatformConfig,
        register_data: Bytes,
    ) {
        market::init(&e, market_id, seller, params, platform, &register_data);
    }

    pub fn open_market(e: Env) {
        market::open(&e);
    }

    pub fn cancel_market(e: Env) {
        market::cancel(&e);
    }

    pub fn close_market(e: Env, caller: Address) {
        market::close(&e, &caller);
    }

    pub fn finalize(e: Env, caller: Address, filled_quantities: Vec<u32>, proof: Bytes) {
        market::finalize(&e, &caller, &filled_quantities, &proof);
    }

    pub fn cancel_expired(e: Env, caller: Address) {
        market::cancel_expired(&e, &caller);
    }

    pub fn settle(
        e: Env,
        caller: Address,
        bid_index: u32,
        seller_data: Bytes,
        fee_data: Bytes,
        refund_data: Bytes,
        proof: Bytes,
    ) -> SettleOutcome {
        settlement::settle(
            &e,
            &caller,
            bid_index,
            &seller_data,
            &fee_data,
            &refund_data,
            &proof,
        )
    }

    pub fn release_unsettled(e: Env, caller: Address, bid_index: u32) {
        settlement::release_unsettled(&e, &caller, bid_index);
    }

    pub fn get_settlement_status(e: Env, bid_index: u32) -> BidStatus {
        settlement::status(&e, bid_index)
    }

    pub fn get_commitments_root(e: Env) -> Option<BytesN<32>> {
        market::read_root(&e)
    }

    pub fn get_finalize_by_ledger(e: Env) -> Option<u32> {
        market::read_finalize_by(&e)
    }

    pub fn get_fee_reserve(e: Env) -> i128 {
        market::read_fee_reserve(&e)
    }

    pub fn register_participant(e: Env, participant: Address) -> u32 {
        bidding::register(&e, &participant)
    }

    pub fn get_participant_id(e: Env, participant: Address) -> Option<u32> {
        bidding::read_participant_id(&e, &participant)
    }

    pub fn get_participant(e: Env, participant_id: u32) -> Option<Address> {
        bidding::read_participant_addr(&e, participant_id)
    }

    pub fn submit_bid(e: Env, bidder: Address, bid: BidSubmission) -> u32 {
        bidding::submit(&e, &bidder, &bid)
    }

    pub fn get_bid_count(e: Env) -> u32 {
        bidding::bid_count(&e)
    }

    pub fn get_bid_record(e: Env, bid_index: u32) -> BidRecord {
        bidding::read_bid(&e, bid_index)
    }

    pub fn get_allocation(e: Env) -> Vec<u32> {
        bidding::allocation(&e)
    }

    pub fn has_nullifier(e: Env, nullifier: BytesN<32>) -> bool {
        bidding::has_nullifier(&e, &nullifier)
    }

    pub fn get_market(e: Env) -> MarketConfig {
        market::read_config(&e)
    }

    pub fn get_config_hash(e: Env) -> Option<BytesN<32>> {
        market::read_config_hash(&e)
    }

    pub fn get_state(e: Env) -> MarketStatus {
        market::read_state(&e)
    }
}

#[cfg(test)]
mod test;
