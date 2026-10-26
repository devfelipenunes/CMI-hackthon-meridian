use soroban_sdk::token::TokenClient;
use soroban_sdk::{contractevent, panic_with_error, Address, Bytes, Env};

use shared::types::{BidStatus, MarketStatus, SettleOutcome};

use crate::bidding;
use crate::crypto::{self, SettlementInputs};
use crate::external;
use crate::market;
use crate::types::AuctionError;

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BidSettled {
    #[topic]
    pub bidder: Address,
    pub bid_index: u32,
    pub filled_quantity: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BidFailed {
    #[topic]
    pub bidder: Address,
    pub bid_index: u32,
    pub filled_quantity: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketSettled {
    #[topic]
    pub market_id: u64,
}

pub(crate) fn settle(
    e: &Env,
    caller: &Address,
    bid_index: u32,
    seller_data: &Bytes,
    fee_data: &Bytes,
    refund_data: &Bytes,
    proof: &Bytes,
) -> SettleOutcome {
    if bid_index >= bidding::bid_count(e) {
        panic_with_error!(e, AuctionError::BidNotFound);
    }

    let record = bidding::read_bid(e, bid_index);

    match record.status {
        BidStatus::Settled => return SettleOutcome::AlreadySettled,

        BidStatus::Failed => panic_with_error!(e, AuctionError::BidAlreadyClosed),
        BidStatus::Pending => {}
    }

    let state = market::read_state(e);
    if !matches!(state, MarketStatus::Finalized | MarketStatus::Cancelled) {
        panic_with_error!(e, AuctionError::InvalidState);
    }

    if state == MarketStatus::Cancelled && record.filled_quantity != 0 {
        panic_with_error!(e, AuctionError::InvalidState);
    }

    caller.require_auth();

    let c_seller = external::decode_transfer_data(e, seller_data);
    let c_fee = external::decode_transfer_data(e, fee_data);
    let c_refund = external::decode_transfer_data(e, refund_data);

    let config = market::read_config(e);
    let public_inputs = crypto::settlement_inputs(
        e,
        &SettlementInputs {
            bid_commitment: &record.commitment,
            requested_quantity: record.requested_quantity,
            filled_quantity: record.filled_quantity,
            fee_bps: config.fee_bps,
            c_seller: &c_seller,
            c_fee: &c_fee,
            c_refund: &c_refund,
        },
    );

    if !external::verify_settlement_proof(
        e,
        &config.platform.settlement_verifier,
        &public_inputs,
        proof,
    ) {
        panic_with_error!(e, AuctionError::InvalidSettlementProof);
    }

    let token = &config.platform.collateral_token;
    external::transfer_from(e, token, &record.bidder, &config.seller, seller_data);
    external::transfer_from(
        e,
        token,
        &record.bidder,
        &config.platform.fee_wallet,
        fee_data,
    );
    external::transfer_from(e, token, &record.bidder, &record.bidder, refund_data);

    let filled = record.filled_quantity;
    if filled > 0 {
        TokenClient::new(e, &config.params.quota_asset).transfer(
            &e.current_contract_address(),
            &record.bidder,
            &market::quota_units(filled),
        );
    }

    bidding::close_bid(e, bid_index, BidStatus::Settled);
    let open = close_one_bid(e);
    market::reimburse(e, caller);
    let ended = end_market_if_done(e, open);

    BidSettled {
        bidder: record.bidder,
        bid_index,
        filled_quantity: filled,
    }
    .publish(e);
    publish_market_settled(e, ended);

    SettleOutcome::Settled
}

pub(crate) fn release_unsettled(e: &Env, caller: &Address, bid_index: u32) {
    if bid_index >= bidding::bid_count(e) {
        panic_with_error!(e, AuctionError::BidNotFound);
    }

    let record = bidding::read_bid(e, bid_index);

    if record.status != BidStatus::Pending {
        panic_with_error!(e, AuctionError::BidAlreadyClosed);
    }

    let state = market::read_state(e);
    if !matches!(state, MarketStatus::Finalized | MarketStatus::Cancelled) {
        panic_with_error!(e, AuctionError::InvalidState);
    }

    caller.require_auth();

    let config = market::read_config(e);
    if external::is_spender(e, &config.platform.collateral_token, &record.bidder) {
        panic_with_error!(e, AuctionError::DelegationStillActive);
    }

    let filled = record.filled_quantity;
    if filled > 0 {
        TokenClient::new(e, &config.params.quota_asset).transfer(
            &e.current_contract_address(),
            &config.seller,
            &market::quota_units(filled),
        );
    }

    bidding::close_bid(e, bid_index, BidStatus::Failed);
    let open = close_one_bid(e);
    market::reimburse(e, caller);
    let ended = end_market_if_done(e, open);

    BidFailed {
        bidder: record.bidder,
        bid_index,
        filled_quantity: filled,
    }
    .publish(e);
    publish_market_settled(e, ended);
}

fn publish_market_settled(e: &Env, ended: Option<u64>) {
    if let Some(market_id) = ended {
        MarketSettled { market_id }.publish(e);
    }
}

fn close_one_bid(e: &Env) -> u32 {
    let open = market::read_open_bids(e)
        .unwrap_or_else(|| panic_with_error!(e, AuctionError::InvalidState));
    market::write_open_bids(e, open - 1);
    open - 1
}

fn end_market_if_done(e: &Env, open: u32) -> Option<u64> {
    if open > 0 {
        return None;
    }

    let config = market::read_config(e);

    let rest = market::read_fee_reserve(e);
    if rest > 0 {
        TokenClient::new(e, &config.platform.fee_asset).transfer(
            &e.current_contract_address(),
            &config.seller,
            &rest,
        );
    }
    market::write_fee_reserve(e, 0);

    if market::read_state(e) == MarketStatus::Finalized {
        market::transition(e, MarketStatus::Settled);
    }

    Some(config.market_id)
}

pub(crate) fn status(e: &Env, bid_index: u32) -> BidStatus {
    bidding::read_bid(e, bid_index).status
}
