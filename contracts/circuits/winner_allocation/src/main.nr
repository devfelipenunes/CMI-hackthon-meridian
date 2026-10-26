use cmi_lib::bid;
use cmi_lib::domains::{EMPTY_LEAF, MAX_BIDS};
use cmi_lib::poseidon2;

fn main(
    commitments_root: pub Field,
    requested_quantities: pub [u64; MAX_BIDS],
    filled_quantities: pub [u64; MAX_BIDS],
    bid_count: pub u32,
    total_supply: pub u64,
    market_id: pub Field,
    auction_rule: pub Field,
    config_hash_lo: pub Field,
    config_hash_hi: pub Field,
    clearing_price: u64,
    prices: [u64; MAX_BIDS],
    blindings: [Field; MAX_BIDS],
    nullifier_seeds: [Field; MAX_BIDS],
    participant_ids: [Field; MAX_BIDS],
) {
    let mut leaves: [Field; MAX_BIDS] = [EMPTY_LEAF; MAX_BIDS];
    for i in 0..MAX_BIDS {
        if i < bid_count {
            bid::assert_price_range(prices[i] as Field);
            let commitment_i = bid::commitment(
                prices[i] as Field,
                market_id,
                participant_ids[i],
                blindings[i],
                nullifier_seeds[i],
            );
            leaves[i] = bid::leaf(i, commitment_i);
        } else {
            assert(prices[i] == 0);
            assert(requested_quantities[i] == 0);
            assert(filled_quantities[i] == 0);
        }
    }
    assert(poseidon2::hash(leaves) == commitments_root);

    assert(auction_rule == 1);

    let mut above_total: u64 = 0;
    let mut tied_used: u64 = 0;

    for i in 0..MAX_BIDS {
        let active = i < bid_count;
        let is_above = active & (prices[i] > clearing_price);
        let is_tied = active & (prices[i] == clearing_price);

        let remaining_before_i: u64 = total_supply - above_total - tied_used;
        let tied_fill_i: u64 = if requested_quantities[i] < remaining_before_i {
            requested_quantities[i]
        } else {
            remaining_before_i
        };

        let expected_filled_i: u64 = if is_above {
            requested_quantities[i]
        } else if is_tied {
            tied_fill_i
        } else {
            0
        };

        assert(filled_quantities[i] == expected_filled_i);

        above_total += if is_above { requested_quantities[i] } else { 0 };
        tied_used += if is_tied { filled_quantities[i] } else { 0 };
    }

    let mut total_filled: u64 = 0;
    let mut total_requested: u64 = 0;
    for i in 0..MAX_BIDS {
        total_filled += filled_quantities[i];
        total_requested += requested_quantities[i];
    }
    let expected_total: u64 = if total_requested < total_supply {
        total_requested
    } else {
        total_supply
    };
    assert(total_filled == expected_total);

    let _ = config_hash_lo;
    let _ = config_hash_hi;
}

global MARKET_ID: Field = 42;
global AUCTION_RULE: Field = 1;

global CONFIG_HASH_LO: Field = 0x1234567890abcdef;
global CONFIG_HASH_HI: Field = 0x0fedcba098765432;

struct Scenario {
    commitments_root: Field,
    requested_quantities: [u64; MAX_BIDS],
    filled_quantities: [u64; MAX_BIDS],
    bid_count: u32,
    total_supply: u64,
    clearing_price: u64,
    prices: [u64; MAX_BIDS],
    blindings: [Field; MAX_BIDS],
    nullifier_seeds: [Field; MAX_BIDS],
    participant_ids: [Field; MAX_BIDS],
}

fn prove(s: Scenario) {
    main(
        s.commitments_root,
        s.requested_quantities,
        s.filled_quantities,
        s.bid_count,
        s.total_supply,
        MARKET_ID,
        AUCTION_RULE,
        CONFIG_HASH_LO,
        CONFIG_HASH_HI,
        s.clearing_price,
        s.prices,
        s.blindings,
        s.nullifier_seeds,
        s.participant_ids,
    );
}

fn root_of(
    prices: [u64; MAX_BIDS],
    blindings: [Field; MAX_BIDS],
    nullifier_seeds: [Field; MAX_BIDS],
    participant_ids: [Field; MAX_BIDS],
    bid_count: u32,
) -> Field {
    let mut leaves: [Field; MAX_BIDS] = [EMPTY_LEAF; MAX_BIDS];
    for i in 0..MAX_BIDS {
        if i < bid_count {
            let c = bid::commitment(
                prices[i] as Field,
                MARKET_ID,
                participant_ids[i],
                blindings[i],
                nullifier_seeds[i],
            );
            leaves[i] = bid::leaf(i, c);
        }
    }
    poseidon2::hash(leaves)
}

fn scenario(
    prices: [u64; MAX_BIDS],
    requested: [u64; MAX_BIDS],
    filled: [u64; MAX_BIDS],
    bid_count: u32,
    total_supply: u64,
    clearing_price: u64,
) -> Scenario {
    let blindings: [Field; MAX_BIDS] = [111, 222, 333, 444, 555, 666, 777, 888];
    let nullifier_seeds: [Field; MAX_BIDS] = [11, 22, 33, 44, 55, 66, 77, 88];
    let participant_ids: [Field; MAX_BIDS] = [0, 1, 2, 3, 4, 5, 6, 7];

    Scenario {
        commitments_root: root_of(
            prices,
            blindings,
            nullifier_seeds,
            participant_ids,
            bid_count,
        ),
        requested_quantities: requested,
        filled_quantities: filled,
        bid_count,
        total_supply,
        clearing_price,
        prices,
        blindings,
        nullifier_seeds,
        participant_ids,
    }
}

#[test]
fn poc4_eight_bids_partial_fill_at_the_margin() {
    let s = scenario(
        [650, 620, 600, 590, 580, 580, 570, 560],
        [200, 150, 300, 250, 400, 400, 100, 100],
        [200, 150, 300, 250, 300, 0, 0, 0],
        8,
        1200,
        580,
    );

    assert(
        s.commitments_root == 0x10ae0175e4be6d51d0d1f2b2cbb546e77181252001da07c1956820dd22d115d0,
    );
    prove(s);
}

#[test]
fn undersubscribed_fills_everyone_in_full() {
    let s = scenario(
        [650, 600, 580, 0, 0, 0, 0, 0],
        [200, 500, 300, 0, 0, 0, 0, 0],
        [200, 500, 300, 0, 0, 0, 0, 0],
        3,
        5000,
        0,
    );

    assert(
        s.commitments_root == 0x0595d9bed9bf2569c90da45fb2efc291a44880034fdade77fb3c4f8518215dc7,
    );
    prove(s);
}

#[test]
fn fcfs_tiebreak_lowest_index_wins() {
    let s = scenario(
        [650, 580, 580, 0, 0, 0, 0, 0],
        [200, 900, 900, 0, 0, 0, 0, 0],
        [200, 800, 0, 0, 0, 0, 0, 0],
        3,
        1000,
        580,
    );

    assert(
        s.commitments_root == 0x1bf80622b3e7cfed830bc2f7c7e76f71d9b28fac590840d10aa996a19a912840,
    );
    prove(s);
}

#[test]
fn single_bid_is_filled_in_full() {
    prove(scenario(
        [700, 0, 0, 0, 0, 0, 0, 0],
        [400, 0, 0, 0, 0, 0, 0, 0],
        [400, 0, 0, 0, 0, 0, 0, 0],
        1,
        1000,
        650,
    ));
}

#[test]
fn clearing_price_in_a_gap_between_bids() {
    prove(scenario(
        [650, 600, 0, 0, 0, 0, 0, 0],
        [300, 500, 0, 0, 0, 0, 0, 0],
        [300, 0, 0, 0, 0, 0, 0, 0],
        2,
        300,
        620,
    ));
}

#[test(should_fail)]
fn filled_differing_at_a_position_fails() {
    let mut s = scenario(
        [650, 620, 0, 0, 0, 0, 0, 0],
        [200, 150, 0, 0, 0, 0, 0, 0],
        [200, 150, 0, 0, 0, 0, 0, 0],
        2,
        1000,
        620,
    );
    s.filled_quantities[0] = 199;
    prove(s);
}

#[test(should_fail)]
fn wrong_root_fails() {
    let mut s = scenario(
        [650, 620, 0, 0, 0, 0, 0, 0],
        [200, 150, 0, 0, 0, 0, 0, 0],
        [200, 150, 0, 0, 0, 0, 0, 0],
        2,
        1000,
        620,
    );
    s.commitments_root = s.commitments_root + 1;
    prove(s);
}

#[test(should_fail)]
fn a_real_leaf_in_the_padding_fails() {
    let mut s = scenario(
        [650, 620, 0, 0, 0, 0, 0, 0],
        [200, 150, 0, 0, 0, 0, 0, 0],
        [200, 150, 0, 0, 0, 0, 0, 0],
        2,
        1000,
        620,
    );

    let prices: [u64; MAX_BIDS] = [650, 620, 500, 500, 500, 500, 500, 500];
    s.commitments_root = root_of(prices, s.blindings, s.nullifier_seeds, s.participant_ids, 8);
    prove(s);
}

#[test(should_fail)]
fn filled_at_an_empty_position_fails() {
    let mut s = scenario(
        [650, 620, 0, 0, 0, 0, 0, 0],
        [200, 150, 0, 0, 0, 0, 0, 0],
        [200, 150, 0, 0, 0, 0, 0, 0],
        2,
        1000,
        620,
    );
    s.filled_quantities[3] = 1;
    prove(s);
}

#[test(should_fail)]
fn margin_rationed_in_the_wrong_order_fails() {
    let mut s = scenario(
        [650, 580, 580, 0, 0, 0, 0, 0],
        [200, 900, 900, 0, 0, 0, 0, 0],
        [200, 800, 0, 0, 0, 0, 0, 0],
        3,
        1000,
        580,
    );
    s.filled_quantities[1] = 0;
    s.filled_quantities[2] = 800;
    prove(s);
}

#[test(should_fail)]
fn filled_above_the_supply_fails() {
    let mut s = scenario(
        [650, 620, 0, 0, 0, 0, 0, 0],
        [200, 150, 0, 0, 0, 0, 0, 0],
        [200, 150, 0, 0, 0, 0, 0, 0],
        2,
        300,
        620,
    );

    s.filled_quantities[1] = 150;
    prove(s);
}

#[test(should_fail)]
fn auction_rule_other_than_one_fails() {
    let s = scenario(
        [650, 620, 0, 0, 0, 0, 0, 0],
        [200, 150, 0, 0, 0, 0, 0, 0],
        [200, 150, 0, 0, 0, 0, 0, 0],
        2,
        1000,
        620,
    );

    main(
        s.commitments_root,
        s.requested_quantities,
        s.filled_quantities,
        s.bid_count,
        s.total_supply,
        MARKET_ID,
        2,
        CONFIG_HASH_LO,
        CONFIG_HASH_HI,
        s.clearing_price,
        s.prices,
        s.blindings,
        s.nullifier_seeds,
        s.participant_ids,
    );
}
