use crate::domains::{BID_COMMIT_DOMAIN, BID_LEAF_DOMAIN, NULLIFIER_DOMAIN};
use crate::poseidon2;

pub fn commitment(
    price: Field,
    market_id: Field,
    participant_id: Field,
    blinding: Field,
    nullifier_seed: Field,
) -> Field {
    poseidon2::hash(
        [BID_COMMIT_DOMAIN, price, market_id, participant_id, blinding, nullifier_seed],
    )
}

pub fn leaf(bid_index: u32, commitment: Field) -> Field {
    poseidon2::hash([BID_LEAF_DOMAIN, bid_index as Field, commitment])
}

pub fn nullifier(nullifier_seed: Field, market_id: Field, participant_id: Field) -> Field {
    poseidon2::hash(
        [NULLIFIER_DOMAIN, nullifier_seed, market_id, participant_id],
    )
}

pub fn assert_price_range(price: Field) {
    assert(price != 0);
    price.assert_max_bit_size::<63>();
}

#[test]
fn commitment_test_vector() {
    let c = commitment(650, 42, 7, 111222333444, 999888777);
    assert(c == 0x02a90cb9c403c8001ce4bf3f4ed7376804d7101074cb1ebc42cdb13069136281);
}

#[test]
fn commitment_changes_with_blinding() {
    let a = commitment(650, 42, 7, 111222333444, 999888777);
    let b = commitment(650, 42, 7, 111222333445, 999888777);
    assert(a != b);
}

#[test]
fn commitment_changes_with_market_id() {
    let a = commitment(650, 42, 7, 111222333444, 999888777);
    let b = commitment(650, 43, 7, 111222333444, 999888777);
    assert(a != b);
}

#[test]
fn commitment_changes_with_participant_id() {
    let a = commitment(650, 42, 7, 111222333444, 999888777);
    let b = commitment(650, 42, 8, 111222333444, 999888777);
    assert(a != b);
}

#[test]
fn leaf_test_vector() {
    let c = commitment(650, 42, 7, 111222333444, 999888777);
    assert(leaf(0, c) == 0x145f2247e344c87afc9ca575bedd1b67b3845f621c594e7b6f74165effd9a9ca);
    assert(leaf(7, c) == 0x0644492bc19bd78ad04d67ff3bcb503e6348773f666c018a7f3959b8be200574);
}

#[test]
fn leaf_changes_with_index() {
    let c = commitment(650, 42, 7, 111222333444, 999888777);
    assert(leaf(0, c) != leaf(1, c));
}

#[test]
fn nullifier_changes_with_market_id() {
    assert(nullifier(999888777, 42, 7) != nullifier(999888777, 43, 7));
}

#[test]
fn nullifier_changes_with_participant_id() {
    assert(nullifier(999888777, 42, 7) != nullifier(999888777, 42, 8));
}

#[test(should_fail)]
fn price_range_rejects_zero() {
    assert_price_range(0);
}

#[test(should_fail)]
fn price_range_rejects_2_pow_63() {
    assert_price_range(9223372036854775808);
}
