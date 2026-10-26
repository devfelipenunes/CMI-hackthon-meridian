mod common;

use shared::types::MarketStatus;
use soroban_sdk::Vec;

use auction::crypto::{self, BidValidityInputs};
use auction::types::AuctionError;

use common::{
    bid_count, collateral_binding, config_hash, has_nullifier, hex, hex_bytes, submit, submit_err,
};

#[test]
fn bid_validity_real_proof_accepted() {
    let w = common::new_world();
    let ctx = common::context();
    let proof = common::proof();
    let bid = common::submission(&w.e, &proof);

    assert_eq!(hex(&config_hash(&w).to_array()), ctx.config_hash);
    assert_eq!(common::participant_id(&w, &w.bidder), ctx.participant_id);
    assert_eq!(bid.requested_quantity, ctx.requested_quantity);

    let c_a = collateral_binding(&w.e);
    common::set_delegation(&w, &w.bidder, &c_a);

    let inputs = crypto::bid_validity_inputs(
        &w.e,
        &BidValidityInputs {
            commitment: &bid.commitment,
            nullifier: &bid.nullifier,
            market_id: ctx.market_id,
            participant_id: ctx.participant_id,
            requested_quantity: bid.requested_quantity,
            min_price_per_quota: ctx.min_price_per_quota,
            collateral_binding: &c_a,
            envelope: &bid.envelope,
            config_hash: &config_hash(&w),
        },
    );
    assert_eq!(
        hex_bytes(&inputs),
        hex(&common::public_inputs()),
        "the contract's public inputs differ from the ones the circuit proved"
    );

    let index = submit(&w, &w.bidder, &bid).expect("the real proof was rejected");

    assert_eq!(index, 0);
    assert_eq!(bid_count(&w), 1);
    assert!(has_nullifier(&w, &bid.nullifier));
}

#[test]
fn bid_validity_tampered_proof_rejected() {
    let w = common::new_world();
    let mut tampered = common::proof();
    tampered[5000] ^= 0xff;
    let bid = common::submission(&w.e, &tampered);

    common::set_delegation(&w, &w.bidder, &collateral_binding(&w.e));

    assert_eq!(
        submit_err(&w, &w.bidder, &bid),
        AuctionError::InvalidBidProof
    );

    assert_eq!(state(&w), MarketStatus::Open);
    assert_eq!(bid_count(&w), 0);
    assert!(!has_nullifier(&w, &bid.nullifier));
}

#[test]
fn bid_validity_wrong_state_input_rejected() {
    let w = common::new_world();
    let bid = common::submission(&w.e, &common::proof());

    common::set_delegation(&w, &w.other, &collateral_binding(&w.e));
    assert_ne!(
        common::participant_id(&w, &w.other),
        common::participant_id(&w, &w.bidder),
        "the test needs two distinct ids to be valid"
    );

    assert_eq!(
        submit_err(&w, &w.other, &bid),
        AuctionError::InvalidBidProof
    );

    assert_eq!(state(&w), MarketStatus::Open);
    assert_eq!(bid_count(&w), 0);
    assert!(!has_nullifier(&w, &bid.nullifier));
}

#[test]
fn bid_validity_wrong_config_hash_rejected() {
    let w = common::new_world_with_close_ledger(common::START_LEDGER + 2_000);
    let ctx = common::context();

    assert_ne!(
        hex(&config_hash(&w).to_array()),
        ctx.config_hash,
        "the config changed and the config_hash did not"
    );
    assert_eq!(common::participant_id(&w, &w.bidder), ctx.participant_id);

    let bid = common::submission(&w.e, &common::proof());
    common::set_delegation(&w, &w.bidder, &collateral_binding(&w.e));

    assert_eq!(
        submit_err(&w, &w.bidder, &bid),
        AuctionError::InvalidBidProof
    );

    assert_eq!(state(&w), MarketStatus::Open);
    assert_eq!(bid_count(&w), 0);
    assert!(!has_nullifier(&w, &bid.nullifier));
}

const SUBMIT_BID_CPU_MEASURED: u64 = 82_498_053;

const SUBMIT_BID_CPU_CEILING: u64 = SUBMIT_BID_CPU_MEASURED * 11 / 10;

#[test]
fn budget_submit_bid() {
    let w = common::new_world();
    let bid = common::submission(&w.e, &common::proof());
    common::set_delegation(&w, &w.bidder, &collateral_binding(&w.e));

    let mut budget = w.e.cost_estimate().budget();
    budget.reset_unlimited();
    submit(&w, &w.bidder, &bid).expect("the real proof was rejected");
    let cpu = budget.cpu_instruction_cost();

    std::println!("submit_bid with real proof: {cpu} CPU instructions");

    assert!(cpu > 0, "the budget measured nothing");
    assert!(
        cpu <= SUBMIT_BID_CPU_CEILING,
        "submit_bid cost {cpu} instructions, above the ceiling {SUBMIT_BID_CPU_CEILING} \
         (measured {SUBMIT_BID_CPU_MEASURED} + 10%): explain the regression in the PR and update the number"
    );
}

fn state(w: &common::World) -> MarketStatus {
    w.e.invoke_contract(
        &w.auction,
        &soroban_sdk::Symbol::new(&w.e, "get_state"),
        Vec::new(&w.e),
    )
}
