mod common;

use shared::types::{MarketStatus, SettleOutcome, QUOTA_UNIT};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::Address;

use auction::types::AuctionError;

use common::SETTLE_CASES;

#[test]
fn settle_real_proof_partial() {
    let case = "partial";
    let w = common::settle_world(case);

    assert_eq!(
        w.filled(),
        120,
        "the partial case of the canonical scenario"
    );
    assert_eq!(w.state(), MarketStatus::Finalized);

    let (seller, fee, refund) = common::legs(&w);
    let keeper = Address::generate(&w.e);
    let outcome = common::settle(
        &w,
        &keeper,
        0,
        &seller,
        &fee,
        &refund,
        &common::settle_proof(case),
    )
    .expect("the real settlement_binding proof was rejected");

    assert_eq!(outcome, SettleOutcome::Settled);
    assert_eq!(
        w.state(),
        MarketStatus::Settled,
        "the bid was the only open one"
    );
    assert_eq!(w.bid_record().status, shared::types::BidStatus::Settled);

    let legs = w.legs();
    assert_eq!(legs.len(), 3, "the three legs always run (D-08)");
    assert_eq!(legs.get(0).unwrap().to, w.seller, "leg 0 is the seller's");
    assert_eq!(
        legs.get(1).unwrap().to,
        w.fee_wallet,
        "leg 1 is the house fee's"
    );
    assert_eq!(
        legs.get(2).unwrap().to,
        w.bidder,
        "leg 2 is the refund to the bidder"
    );

    let inputs = common::settle_public_inputs(case);
    assert_eq!(inputs.len(), 320, "the 10 fields of 32 bytes");
    for (leg, at) in [(0u32, 128usize), (1, 192), (2, 256)] {
        assert_eq!(
            common::hex(&legs.get(leg).unwrap().c_tx.to_array()),
            common::hex(&inputs[at..at + 64]),
            "the `c_tx` of leg {leg} is not public input {at}"
        );
    }

    assert_eq!(
        w.bidder_quotas(),
        120 * QUOTA_UNIT,
        "the won quotas were delivered"
    );
}

#[test]
fn settle_real_proof_full() {
    let case = "full";
    let w = common::settle_world(case);

    assert_eq!(w.filled(), 200, "the whole bid");

    let (seller, fee, refund) = common::legs(&w);
    let keeper = Address::generate(&w.e);
    let outcome = common::settle(
        &w,
        &keeper,
        0,
        &seller,
        &fee,
        &refund,
        &common::settle_proof(case),
    )
    .expect("the real settlement_binding proof was rejected");

    assert_eq!(outcome, SettleOutcome::Settled);
    assert_eq!(w.legs().len(), 3, "the zero-value leg runs the same (D-08)");
    assert_eq!(
        w.bidder_quotas(),
        200 * QUOTA_UNIT,
        "the escrow left in full"
    );
}

#[test]
fn settle_real_proof_zero() {
    let case = "zero";
    let w = common::settle_world(case);

    assert_eq!(w.filled(), 0, "the bid ended up with nothing");
    assert_eq!(
        w.state(),
        MarketStatus::Finalized,
        "but the market was judged"
    );

    let (seller, fee, refund) = common::legs(&w);
    let keeper = Address::generate(&w.e);
    let outcome = common::settle(
        &w,
        &keeper,
        0,
        &seller,
        &fee,
        &refund,
        &common::settle_proof(case),
    )
    .expect("the real settlement_binding proof was rejected");

    assert_eq!(outcome, SettleOutcome::Settled);
    assert_eq!(
        w.legs().len(),
        3,
        "the three legs, two of them with zero value"
    );
    assert_eq!(w.bidder_quotas(), 0, "whoever did not win takes no quota");
    assert_eq!(
        w.escrow(),
        200 * QUOTA_UNIT,
        "and the escrow stays whole: who returns the unsold ones is `finalize`, not `settle`"
    );
}

#[test]
fn settle_real_proof_fee_skipped_rejected() {
    let case = "partial";
    let w = common::settle_world(case);

    let (seller, _, _) = common::legs(&w);

    let wrong_fee = common::leg(&w, &soroban_sdk::BytesN::from_array(&w.e, &w.case.c_refund));
    let (_, _, refund) = common::legs(&w);

    let bidder_before = w.bidder_quotas();
    let keeper = Address::generate(&w.e);
    let result = common::settle(
        &w,
        &keeper,
        0,
        &seller,
        &wrong_fee,
        &refund,
        &common::settle_proof(case),
    );

    match result {
        Ok(_) => panic!("the proof accepted a swapped fee"),
        Err(Ok(err)) => assert_eq!(err, AuctionError::InvalidSettlementProof),
        Err(Err(err)) => panic!("the call did not reach the contract: {err:?}"),
    }

    assert_eq!(
        w.state(),
        MarketStatus::Finalized,
        "the state cannot change"
    );
    assert_eq!(
        w.bid_record().status,
        shared::types::BidStatus::Pending,
        "the bid cannot have been closed"
    );
    assert_eq!(w.bidder_quotas(), bidder_before, "the quotas did not move");
    assert_eq!(w.legs().len(), 0, "no leg ran");
}

const SETTLE_CPU_MEASURED: u64 = 83_436_669;

const SETTLE_CPU_CEILING: u64 = SETTLE_CPU_MEASURED * 11 / 10;

const NETWORK_CPU_LIMIT: u64 = 400_000_000;

#[test]
fn budget_settle_under_400m() {
    let case = "partial";
    let w = common::settle_world(case);
    let (seller, fee, refund) = common::legs(&w);
    let keeper = Address::generate(&w.e);
    let proof = common::settle_proof(case);

    let mut budget = w.e.cost_estimate().budget();
    budget.reset_unlimited();
    common::settle(&w, &keeper, 0, &seller, &fee, &refund, &proof)
        .expect("the real settlement_binding proof was rejected");
    let cpu = budget.cpu_instruction_cost();

    std::println!("settle with real proof (10 public inputs, fake token): {cpu} instructions");

    assert!(cpu > 0, "the budget measured nothing");
    assert!(
        cpu <= SETTLE_CPU_CEILING,
        "settle cost {cpu} instructions, above the ceiling {SETTLE_CPU_CEILING} \
         (measured {SETTLE_CPU_MEASURED} + 10%): explain the regression in the PR and update the number"
    );
    assert!(
        cpu < NETWORK_CPU_LIMIT,
        "settle blew past the guardrail 22 ceiling: {cpu}"
    );
}

#[test]
fn every_settle_case_has_a_fitting_scenario() {
    for case in SETTLE_CASES {
        let w = common::settle_world(case);
        assert_eq!(
            w.filled(),
            w.case.filled_quantity,
            "the bid's `filled` in {case} is not the one from Prover.toml"
        );
        assert_eq!(
            common::settle_public_inputs(case).len(),
            320,
            "the public inputs of {case} do not have 10 fields"
        );
        assert_eq!(
            common::settle_proof(case).len(),
            14_592,
            "the proof of {case} does not have the VK size"
        );
    }
}
