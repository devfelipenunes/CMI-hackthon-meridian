mod common;

use common::*;

use auction::types::MarketStatus;
use shared::types::{
    BidStatus, SettleOutcome, MIN_FEE_RESERVE, QUOTA_UNIT, REIMBURSEMENT_PER_CALL,
};

fn quota(quantity: u32) -> i128 {
    quantity as i128 * QUOTA_UNIT
}

#[test]
fn full_auction_happy_path() {
    let w = full_world("poc4_8bids");
    let bids = w.scenario.bid_count;
    assert_eq!(bids, 8, "the happy path scenario has eight bids");

    for (i, bidder) in w.bidders.iter().enumerate() {
        assert_eq!(
            w.participant_id(bidder),
            i as u32,
            "registration {i} did not yield participant_id {i}"
        );
    }

    for bid in 0..bids {
        assert_eq!(
            w.submit(bid),
            bid,
            "bid {bid} did not enter at position {bid}"
        );
    }
    assert_eq!(
        w.bid_count(),
        bids,
        "the market did not accept the eight bids"
    );

    w.close();
    assert_eq!(w.state(), MarketStatus::Closed);
    assert_eq!(
        w.root().expect("close_market freezes the root"),
        w.commitments_root(),
        "the frozen root is not the one of the submitted commitments"
    );

    w.finalize();
    assert_eq!(w.state(), MarketStatus::Finalized);

    let allocation = w.allocation();
    for bid in 0..bids {
        assert_eq!(
            allocation.get(bid).unwrap(),
            w.scenario.filled[bid as usize],
            "bid {bid} did not end up with the `filled_quantity` the allocation proof signed"
        );
    }

    for bid in 0..bids {
        assert_eq!(
            w.settle(bid),
            SettleOutcome::Settled,
            "bid {bid} did not settle"
        );
        assert_eq!(
            w.settlement_status(bid),
            BidStatus::Settled,
            "bid {bid} did not end up `Settled`"
        );
    }

    assert_eq!(w.state(), MarketStatus::Settled);

    for (i, bidder) in w.bidders.iter().enumerate() {
        assert_eq!(
            w.quotas_of(bidder),
            quota(w.scenario.filled[i]),
            "bidder {i} did not receive the quotas of their bid"
        );
    }
    assert_eq!(
        w.seller_quotas(),
        0,
        "the seller kept quotas the scenario sold"
    );
    assert_eq!(w.escrow(), 0, "quota was left stuck in the Auction escrow");

    assert_eq!(
        w.fees_of(&w.keeper),
        2 * REIMBURSEMENT_PER_CALL,
        "the keeper did not receive the reimbursement for the close and the finalize"
    );
    for (i, bidder) in w.bidders.iter().enumerate() {
        assert_eq!(
            w.fees_of(bidder),
            REIMBURSEMENT_PER_CALL,
            "bidder {i} did not receive the reimbursement for their settle"
        );
    }
    assert_eq!(
        w.fees_of(&w.seller),
        0,
        "the reserve was left to the seller in a market that spent it entirely"
    );
    assert_eq!(
        w.fees_of(&w.auction),
        0,
        "reserve was left stuck in the Auction"
    );
}

#[test]
fn full_auction_calls_every_leg_in_the_frozen_order() {
    let w = full_world("poc4_8bids");
    let bids = w.scenario.bid_count;
    for bid in 0..bids {
        w.submit(bid);
    }
    w.close();
    w.finalize();
    for bid in 0..bids {
        w.settle(bid);
    }

    let legs = w.legs();
    assert_eq!(
        legs.len(),
        bids * 3,
        "each bid has three legs, and not one more (D-08)"
    );

    for bid in 0..bids {
        let case = settle_case_of("poc4_8bids", bid, w.scenario.filled[bid as usize]);
        let c = settle_case(&case);
        for (leg_index, expected) in [c.c_seller, c.c_fee, c.c_refund].into_iter().enumerate() {
            let leg = legs.get(bid * 3 + leg_index as u32).unwrap();
            assert_eq!(
                leg.c_tx.to_array(),
                expected,
                "leg {leg_index} of bid {bid} is not the one of case {case}"
            );
            assert_eq!(
                leg.from, w.bidders[bid as usize],
                "leg {leg_index} of bid {bid} came from another address"
            );
        }
    }
}

#[test]
fn full_auction_with_revoked_winner() {
    let w = full_world("poc4_8bids");
    let bids = w.scenario.bid_count;
    for bid in 0..bids {
        w.submit(bid);
    }
    w.close();
    w.finalize();

    let revoked = 0u32;
    let revoked_quotas = w.scenario.filled[revoked as usize];
    assert!(
        revoked_quotas > 0,
        "bid {revoked} won no quota: `release_unsettled` would have nothing to return"
    );

    w.revoke_delegation(revoked);
    w.release(revoked);
    assert_eq!(
        w.settlement_status(revoked),
        BidStatus::Failed,
        "the revoked bidder's bid was not closed as `Failed`"
    );
    assert_eq!(
        w.quotas_of(&w.bidders[revoked as usize]),
        0,
        "the revoked bidder received quota they had no way to receive"
    );

    for bid in (revoked + 1)..bids {
        assert_eq!(
            w.settle(bid),
            SettleOutcome::Settled,
            "bid {bid} did not settle"
        );
    }

    assert_eq!(
        w.state(),
        MarketStatus::Settled,
        "the market did not close with a bid marked as `Failed`"
    );

    assert_eq!(
        w.seller_quotas(),
        quota(revoked_quotas),
        "the revoked bidder's quotas did not return to the seller"
    );
    assert_eq!(w.escrow(), 0, "quota was left stuck in the Auction escrow");

    let mut paid = w.fees_of(&w.keeper) + w.fees_of(&w.seller);
    for bidder in &w.bidders {
        paid += w.fees_of(bidder);
    }
    assert_eq!(
        paid, MIN_FEE_RESERVE,
        "the reserve was not paid in full, or it overpaid"
    );
    assert_eq!(
        w.fees_of(&w.auction),
        0,
        "reserve was left stuck in the Auction"
    );
}

#[test]
fn full_auction_timeout() {
    let w = full_world("poc4_8bids");
    let bids = w.scenario.bid_count;
    let supply = w.scenario.total_supply;
    for bid in 0..bids {
        w.submit(bid);
    }
    w.close();

    w.expire();
    assert_eq!(w.state(), MarketStatus::Cancelled);

    assert_eq!(
        w.seller_quotas(),
        quota(supply),
        "the seller did not get the quotas back on cancellation"
    );

    for bid in 0..bids {
        assert_eq!(
            w.settle(bid),
            SettleOutcome::Settled,
            "the refund of bid {bid} did not run"
        );
        assert_eq!(
            w.quotas_of(&w.bidders[bid as usize]),
            0,
            "a cancelled bid delivered quota to someone"
        );
    }

    assert_eq!(w.state(), MarketStatus::Cancelled);
    assert_eq!(
        w.seller_quotas(),
        quota(supply),
        "the seller lost quota in the refunds"
    );

    let mut paid = w.fees_of(&w.keeper) + w.fees_of(&w.seller);
    for bidder in &w.bidders {
        paid += w.fees_of(bidder);
    }
    assert_eq!(paid, MIN_FEE_RESERVE, "the reserve did not balance exactly");
    assert_eq!(
        w.fees_of(&w.auction),
        0,
        "reserve was left stuck in the Auction"
    );
}

#[test]
fn full_auction_undersubscribed_reaches_settled() {
    let w = full_world("undersubscribed");
    let bids = w.scenario.bid_count;
    assert_eq!(bids, 3, "the scenario has three bids");

    let demanded: u32 = w.scenario.filled[..bids as usize].iter().sum();
    let supply = w.scenario.total_supply;
    assert!(
        demanded < supply,
        "the scenario is undersubscribed: {demanded} of {supply}"
    );

    for bid in 0..bids {
        assert_eq!(w.submit(bid), bid, "bid {bid} did not enter");
    }
    w.close();
    w.finalize();

    assert_eq!(w.state(), MarketStatus::Finalized);

    for bid in 0..bids {
        assert_eq!(
            w.settle(bid),
            SettleOutcome::Settled,
            "bid {bid} did not settle"
        );
        assert_eq!(
            w.quotas_of(&w.bidders[bid as usize]),
            quota(w.scenario.filled[bid as usize]),
            "bid {bid} did not receive what it requested"
        );
    }

    assert_eq!(
        w.state(),
        MarketStatus::Settled,
        "RF-03: demand below supply must reach `Settled`, never `Cancelled`"
    );

    assert_eq!(
        w.seller_quotas(),
        quota(supply - demanded),
        "the unsold quotas did not return to the seller"
    );
    assert_eq!(w.escrow(), 0, "quota was left stuck in the Auction escrow");

    let spent = 5 * REIMBURSEMENT_PER_CALL;
    assert_eq!(
        w.fees_of(&w.seller),
        MIN_FEE_RESERVE - spent,
        "the rest of the reserve did not return to the seller"
    );
    assert_eq!(
        w.fees_of(&w.auction),
        0,
        "reserve was left stuck in the Auction"
    );
}

#[test]
fn budget_full_auction() {
    let w = full_world("poc4_8bids");
    let bids = w.scenario.bid_count;

    std::println!();
    std::println!("{:<34} {:>14} {:>14}", "function", "CPU", "memory (B)");
    std::println!("{}", "-".repeat(64));

    let mut measured = std::vec::Vec::new();
    let mut step = |label: &str, run: &mut dyn FnMut()| {
        let mut budget = w.e.cost_estimate().budget();
        budget.reset_unlimited();
        run();
        let cpu = budget.cpu_instruction_cost();
        let mem = budget.memory_bytes_cost();
        std::println!("{label:<34} {cpu:>14} {mem:>14}");
        measured.push((label.to_string(), cpu, mem));
    };

    for bid in 0..bids {
        let label = if bid == 0 {
            "submit_bid (bid_validity)"
        } else {
            "submit_bid (same)"
        };
        step(label, &mut || {
            w.submit(bid);
        });
    }
    step("close_market", &mut || w.close());
    step("finalize (winner_allocation)", &mut || w.finalize());
    for bid in 0..bids {
        let label = if bid == 0 {
            "settle (settlement_binding)"
        } else {
            "settle (same)"
        };
        step(label, &mut || {
            w.settle(bid);
        });
    }

    std::println!(
        "{:<34} {:>14} {:>14}",
        "reserve spent",
        format!("{} XLM", MIN_FEE_RESERVE / 10_000_000),
        ""
    );
    std::println!();

    let first = |prefix: &str| -> u64 {
        measured
            .iter()
            .find(|(label, _, _)| label.starts_with(prefix))
            .map(|(_, cpu, _)| *cpu)
            .unwrap_or_else(|| panic!("did not measure `{prefix}`"))
    };

    let submit = first("submit_bid");
    let finalize = first("finalize");
    let settle = first("settle");

    assert!(
        submit > 0 && finalize > 0 && settle > 0,
        "the budget measured nothing"
    );
    assert!(
        submit < 150_000_000,
        "submit_bid above the per-transaction ceiling: {submit}"
    );
    assert!(
        finalize < 100_000_000,
        "finalize blew past the per-transaction ceiling: {finalize}"
    );
    assert!(
        settle < 400_000_000,
        "settle blew past the guardrail 22 ceiling: {settle}"
    );
}
