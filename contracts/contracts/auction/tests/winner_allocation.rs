mod common;

use shared::types::{MarketStatus, QUOTA_UNIT};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Vec};

use auction::types::AuctionError;

use common::ALLOC_CASES;

#[test]
fn close_root_matches_circuit() {
    for case in ALLOC_CASES {
        let w = common::alloc_world(case);
        assert_eq!(w.state(), MarketStatus::Closed);

        let public_inputs = common::alloc_public_inputs(case);
        assert_eq!(
            public_inputs.len(),
            23 * 32,
            "the winner_allocation public inputs do not have 23 fields"
        );

        let root = w.root().expect("close_market writes the root");
        assert_eq!(
            common::hex(&root.to_array()),
            common::hex(&public_inputs[..32]),
            "field 0 of the {case} public inputs is not the storage root"
        );
    }
}

#[test]
fn allocation_context_matches_the_world() {
    for case in ALLOC_CASES {
        let w = common::alloc_world(case);
        let ctx = common::alloc_context(case);

        assert_eq!(ctx.market_id, w.scenario.market_id, "{case}");
        assert_eq!(ctx.total_supply, w.scenario.total_supply, "{case}");
        assert_eq!(ctx.bid_count, w.scenario.bid_count, "{case}");
        assert_eq!(
            ctx.config_hash,
            common::hex(&w.config_hash().to_array()),
            "the config_hash of {case} changed: rerun `fixtures_dump` and `fixtures.sh`"
        );
    }
}

#[test]
fn finalize_real_proof_partial_fill_margin() {
    let case = "poc4_8bids";
    let w = common::alloc_world(case);

    assert!(
        w.allocation().is_empty(),
        "there is an allocation before finalize"
    );
    let before = w.seller_quotas();

    let caller = Address::generate(&w.e);
    let filled = w.filled();
    common::finalize(&w, &caller, &filled, &common::alloc_proof(case))
        .expect("the real winner_allocation proof was rejected");

    assert_eq!(w.state(), MarketStatus::Finalized);
    assert_eq!(plain(&w.allocation()), w.scenario.filled[..8].to_vec());

    for i in 0..w.scenario.bid_count {
        assert_eq!(
            w.bid_record(i).filled_quantity,
            w.scenario.filled[i as usize],
            "bid {i} ended up with another quantity"
        );
    }

    let unsold: u32 = filled.iter().sum();
    assert_eq!(
        unsold, w.scenario.total_supply,
        "the supply should have gone out in full"
    );
    assert_eq!(w.seller_quotas(), before, "the seller got quota back");
}

#[test]
fn finalize_real_proof_undersubscribed() {
    let case = "undersubscribed";
    let w = common::alloc_world(case);

    let before = w.seller_quotas();
    let caller = Address::generate(&w.e);
    let filled = w.filled();
    common::finalize(&w, &caller, &filled, &common::alloc_proof(case))
        .expect("the real winner_allocation proof was rejected");

    assert_eq!(w.state(), MarketStatus::Finalized);
    assert_eq!(plain(&w.allocation()), w.scenario.filled[..3].to_vec());

    let sold: u32 = filled.iter().sum();
    let unsold = w.scenario.total_supply - sold;
    assert_eq!(unsold, 4_000, "the subscription scenario changed");
    assert_eq!(
        w.seller_quotas(),
        before + unsold as i128 * QUOTA_UNIT,
        "the unsold quotas did not return to the seller"
    );
}

#[test]
fn finalize_real_proof_wrong_allocation_rejected() {
    let case = "poc4_8bids";
    let w = common::alloc_world(case);
    let proof = common::alloc_proof(case);
    let before = w.seller_quotas();

    let mut wrong = w.scenario.filled;
    wrong[4] -= 100;
    wrong[5] += 100;
    let wrong = common::quantities(&w.e, &wrong[..w.scenario.bid_count as usize]);
    assert!(
        wrong.iter().sum::<u32>() == w.scenario.filled[..8].iter().sum::<u32>(),
        "the test allocation must preserve the sum"
    );

    let caller = Address::generate(&w.e);
    assert_eq!(
        finalize_err(&w, &caller, &wrong, &proof),
        AuctionError::InvalidAllocationProof
    );

    assert_eq!(w.state(), MarketStatus::Closed);
    assert!(w.allocation().is_empty());
    assert_eq!(w.seller_quotas(), before);
    assert_eq!(w.bid_record(4).filled_quantity, 0);
}

const FINALIZE_CPU_MEASURED: u64 = 82_590_610;

const FINALIZE_CPU_CEILING: u64 = FINALIZE_CPU_MEASURED * 11 / 10;

#[test]
fn budget_finalize() {
    let case = "poc4_8bids";
    let w = common::alloc_world(case);
    let filled = w.filled();
    let proof = common::alloc_proof(case);
    let caller = Address::generate(&w.e);

    let mut budget = w.e.cost_estimate().budget();
    budget.reset_unlimited();
    common::finalize(&w, &caller, &filled, &proof).expect("the real proof was rejected");
    let cpu = budget.cpu_instruction_cost();

    std::println!("finalize with real proof (23 public inputs): {cpu} CPU instructions");

    assert!(cpu > 0, "the budget measured nothing");
    assert!(
        cpu <= FINALIZE_CPU_CEILING,
        "finalize cost {cpu} instructions, above the ceiling {FINALIZE_CPU_CEILING} \
         (measured {FINALIZE_CPU_MEASURED} + 10%): explain the regression in the PR and update the number"
    );
}

fn finalize_err(
    w: &common::AllocWorld,
    caller: &Address,
    filled: &Vec<u32>,
    proof: &[u8],
) -> AuctionError {
    match common::finalize(w, caller, filled, proof) {
        Ok(()) => panic!("finalize passed when it should have failed"),
        Err(Ok(err)) => err,
        Err(Err(err)) => panic!("the call did not reach the contract: {err:?}"),
    }
}

fn plain(v: &Vec<u32>) -> std::vec::Vec<u32> {
    (0..v.len()).map(|i| v.get(i).unwrap()).collect()
}
