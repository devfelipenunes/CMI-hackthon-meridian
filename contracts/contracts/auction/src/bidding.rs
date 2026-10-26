use soroban_sdk::{contractevent, panic_with_error, Address, BytesN, Env, Vec};

use shared::types::{BidRecord, BidStatus, BidSubmission, MarketStatus, MAX_BIDS};

use crate::crypto::{self, BidValidityInputs};
use crate::external;
use crate::market;
use crate::types::{AuctionError, DataKey};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ParticipantRegistered {
    #[topic]
    pub participant: Address,
    pub participant_id: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BidAccepted {
    #[topic]
    pub bidder: Address,
    pub bid_index: u32,
    pub requested_quantity: u32,
}

pub(crate) fn read_participant_id(e: &Env, participant: &Address) -> Option<u32> {
    e.storage()
        .persistent()
        .get(&DataKey::ParticipantId(participant.clone()))
}

pub(crate) fn read_participant_addr(e: &Env, participant_id: u32) -> Option<Address> {
    e.storage()
        .persistent()
        .get(&DataKey::ParticipantAddr(participant_id))
}

fn read_participant_count(e: &Env) -> u32 {
    e.storage()
        .instance()
        .get(&DataKey::ParticipantCount)
        .unwrap_or(0)
}

pub(crate) fn register(e: &Env, participant: &Address) -> u32 {
    if market::read_state(e) != MarketStatus::Open {
        panic_with_error!(e, AuctionError::InvalidState);
    }

    participant.require_auth();

    if read_participant_id(e, participant).is_some() {
        panic_with_error!(e, AuctionError::AlreadyRegistered);
    }

    let config = market::read_config(e);
    if !external::is_eligible(e, &config, participant) {
        panic_with_error!(e, AuctionError::NotEligible);
    }

    let id = read_participant_count(e);
    let id_key = DataKey::ParticipantId(participant.clone());
    let addr_key = DataKey::ParticipantAddr(id);
    let storage = e.storage();
    storage.persistent().set(&id_key, &id);
    storage.persistent().set(&addr_key, participant);
    storage
        .instance()
        .set(&DataKey::ParticipantCount, &(id + 1));

    market::extend_persistent_ttl(e, &id_key);
    market::extend_persistent_ttl(e, &addr_key);
    market::extend_instance_ttl(e);

    ParticipantRegistered {
        participant: participant.clone(),
        participant_id: id,
    }
    .publish(e);

    id
}

fn read_bids(e: &Env) -> Vec<BidRecord> {
    e.storage()
        .instance()
        .get(&DataKey::Bids)
        .unwrap_or_else(|| Vec::new(e))
}

fn write_bids(e: &Env, bids: &Vec<BidRecord>) {
    e.storage().instance().set(&DataKey::Bids, bids);
    market::extend_instance_ttl(e);
}

pub(crate) fn bid_count(e: &Env) -> u32 {
    read_bids(e).len()
}

pub(crate) fn commitments(e: &Env) -> Vec<BytesN<32>> {
    let bids = read_bids(e);
    let mut commitments = Vec::new(e);
    for record in bids.iter() {
        commitments.push_back(record.commitment.clone());
    }
    commitments
}

pub(crate) fn requested_quantities(e: &Env) -> Vec<u32> {
    let bids = read_bids(e);
    let mut quantities = Vec::new(e);
    for record in bids.iter() {
        quantities.push_back(record.requested_quantity);
    }
    quantities
}

pub(crate) fn write_allocation(e: &Env, filled: &Vec<u32>) {
    let mut bids = Vec::new(e);
    for (mut record, quantity) in read_bids(e).iter().zip(filled.iter()) {
        record.filled_quantity = quantity;
        bids.push_back(record);
    }
    write_bids(e, &bids);
}

pub(crate) fn close_bid(e: &Env, bid_index: u32, status: BidStatus) {
    let mut bids = read_bids(e);
    let mut record = bids
        .get(bid_index)
        .unwrap_or_else(|| panic_with_error!(e, AuctionError::BidNotFound));
    record.status = status;
    bids.set(bid_index, record);
    write_bids(e, &bids);
}

pub(crate) fn allocation(e: &Env) -> Vec<u32> {
    if !matches!(
        market::read_state(e),
        MarketStatus::Finalized | MarketStatus::Settled
    ) {
        return Vec::new(e);
    }

    let bids = read_bids(e);
    let mut allocation = Vec::new(e);
    for record in bids.iter() {
        allocation.push_back(record.filled_quantity);
    }
    allocation
}

pub(crate) fn read_bid(e: &Env, bid_index: u32) -> BidRecord {
    read_bids(e)
        .get(bid_index)
        .unwrap_or_else(|| panic_with_error!(e, AuctionError::BidNotFound))
}

pub(crate) fn has_nullifier(e: &Env, nullifier: &BytesN<32>) -> bool {
    e.storage()
        .persistent()
        .has(&DataKey::Nullifier(nullifier.clone()))
}

fn consume_nullifier(e: &Env, nullifier: &BytesN<32>) {
    let key = DataKey::Nullifier(nullifier.clone());
    e.storage().persistent().set(&key, &());
    market::extend_persistent_ttl(e, &key);
}

pub(crate) fn submit(e: &Env, bidder: &Address, bid: &BidSubmission) -> u32 {
    if market::read_state(e) != MarketStatus::Open {
        panic_with_error!(e, AuctionError::InvalidState);
    }
    let config = market::read_config(e);
    if e.ledger().sequence() >= config.params.close_ledger {
        panic_with_error!(e, AuctionError::BiddingClosed);
    }

    bidder.require_auth();

    let mut bids = read_bids(e);
    if bids.len() >= MAX_BIDS {
        panic_with_error!(e, AuctionError::MarketFull);
    }

    let participant_id = match read_participant_id(e, bidder) {
        Some(id) => id,
        None => panic_with_error!(e, AuctionError::NotRegistered),
    };

    if bids.iter().any(|record| record.bidder == *bidder) {
        panic_with_error!(e, AuctionError::AlreadyBid);
    }

    if bid.requested_quantity == 0 {
        panic_with_error!(e, AuctionError::ZeroQuantity);
    }

    if has_nullifier(e, &bid.nullifier) {
        panic_with_error!(e, AuctionError::NullifierUsed);
    }

    if !external::is_eligible(e, &config, bidder) {
        panic_with_error!(e, AuctionError::NotEligible);
    }

    if !external::has_quota_trustline(e, &config.params.quota_asset, bidder) {
        panic_with_error!(e, AuctionError::NoTrustline);
    }

    if !external::is_spender(e, &config.platform.collateral_token, bidder) {
        panic_with_error!(e, AuctionError::NoCollateral);
    }
    let delegation = external::read_delegation(e, &config.platform.collateral_token, bidder);

    let required_live_until = market::last_transition_ledger(&config);
    if delegation.live_until_ledger < required_live_until {
        panic_with_error!(e, AuctionError::CollateralExpiresTooSoon);
    }

    let config_hash = market::read_open_config_hash(e);

    let public_inputs = crypto::bid_validity_inputs(
        e,
        &BidValidityInputs {
            commitment: &bid.commitment,
            nullifier: &bid.nullifier,
            market_id: config.market_id,
            participant_id,
            requested_quantity: bid.requested_quantity,
            min_price_per_quota: config.params.min_price_per_quota,
            collateral_binding: &delegation.allowance_commitment,
            envelope: &bid.envelope,
            config_hash: &config_hash,
        },
    );
    if !external::verify_bid_proof(e, &config.platform.bid_verifier, &public_inputs, &bid.proof) {
        panic_with_error!(e, AuctionError::InvalidBidProof);
    }

    let bid_index = bids.len();
    bids.push_back(BidRecord {
        bidder: bidder.clone(),
        participant_id,
        commitment: bid.commitment.clone(),
        nullifier: bid.nullifier.clone(),
        requested_quantity: bid.requested_quantity,
        envelope: bid.envelope.clone(),
        filled_quantity: 0,
        status: BidStatus::Pending,
    });
    write_bids(e, &bids);
    consume_nullifier(e, &bid.nullifier);

    BidAccepted {
        bidder: bidder.clone(),
        bid_index,
        requested_quantity: bid.requested_quantity,
    }
    .publish(e);

    bid_index
}
