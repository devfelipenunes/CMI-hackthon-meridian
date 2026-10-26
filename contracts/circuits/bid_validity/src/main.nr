use cmi_lib::bid;
use cmi_lib::domains::BID_ENVELOPE_MASK_DOMAIN;
use cmi_lib::pedersen;
use cmi_lib::poseidon2;
use std::embedded_curve_ops::{EmbeddedCurvePoint, EmbeddedCurveScalar, multi_scalar_mul};

global PK_OPERATOR: EmbeddedCurvePoint = EmbeddedCurvePoint {
    x: 0x1ebe28a1fc051bb1f14169760ae2e47374bfed3406ab44b3125c8f4d7908368c,
    y: 0x0e6a8b7e04813fac76d9776a7da692f6c5ee02dafdbffa94175606f8441d60c8,
    is_infinite: false,
};

fn scalar_mul(point: EmbeddedCurvePoint, scalar: Field) -> EmbeddedCurvePoint {
    multi_scalar_mul([point], [EmbeddedCurveScalar::from_field(scalar)])
}

fn assert_at_least(a: Field, b: Field) {
    let diff = a - b;
    diff.assert_max_bit_size::<63>();
}

fn main(
    commitment: pub Field,
    nullifier: pub Field,
    market_id: pub Field,
    participant_id: pub Field,
    requested_quantity: pub Field,
    min_price_per_quota: pub Field,
    collateral_binding_x: pub Field,
    collateral_binding_y: pub Field,
    r_point_x: pub Field,
    r_point_y: pub Field,
    ciphertext_price: pub Field,
    ciphertext_blinding: pub Field,
    ciphertext_seed: pub Field,
    config_hash_lo: pub Field,
    config_hash_hi: pub Field,
    price: Field,
    blinding: Field,
    nullifier_seed: Field,
    collateral_randomness: Field,
    r: Field,
) {
    let computed_commitment =
        bid::commitment(price, market_id, participant_id, blinding, nullifier_seed);
    assert(computed_commitment == commitment);

    let computed_nullifier = bid::nullifier(nullifier_seed, market_id, participant_id);
    assert(computed_nullifier == nullifier);

    bid::assert_price_range(price);

    assert_at_least(price, min_price_per_quota);

    let collateral = pedersen::commit(price * requested_quantity, collateral_randomness);
    assert(collateral.x == collateral_binding_x);
    assert(collateral.y == collateral_binding_y);

    let r_point = scalar_mul(EmbeddedCurvePoint::generator(), r);
    assert(r_point.x == r_point_x);
    assert(r_point.y == r_point_y);

    let s = scalar_mul(PK_OPERATOR, r);

    let mask_price = poseidon2::hash([BID_ENVELOPE_MASK_DOMAIN, s.x, s.y, 0]);
    let mask_blinding = poseidon2::hash([BID_ENVELOPE_MASK_DOMAIN, s.x, s.y, 1]);
    let mask_seed = poseidon2::hash([BID_ENVELOPE_MASK_DOMAIN, s.x, s.y, 2]);

    assert(ciphertext_price == price + mask_price);
    assert(ciphertext_blinding == blinding + mask_blinding);
    assert(ciphertext_seed == nullifier_seed + mask_seed);

    let _ = config_hash_lo;
    let _ = config_hash_hi;
}

global ANA_PRICE: Field = 650;
global ANA_QUANTITY: Field = 200;
global ANA_BLINDING: Field = 111222333444;
global ANA_NULLIFIER_SEED: Field = 999888777;
global ANA_RANDOMNESS: Field = 424242424242;
global ANA_R: Field = 123456789012;
global ANA_MARKET_ID: Field = 42;
global ANA_PARTICIPANT_ID: Field = 7;
global ANA_MIN_PRICE: Field = 500;

global CONFIG_HASH_LO: Field = 0x1234567890abcdef;
global CONFIG_HASH_HI: Field = 0x0fedcba098765432;

struct Witness {
    commitment: Field,
    nullifier: Field,
    market_id: Field,
    participant_id: Field,
    requested_quantity: Field,
    min_price_per_quota: Field,
    collateral_binding_x: Field,
    collateral_binding_y: Field,
    r_point_x: Field,
    r_point_y: Field,
    ciphertext_price: Field,
    ciphertext_blinding: Field,
    ciphertext_seed: Field,
    config_hash_lo: Field,
    config_hash_hi: Field,
    price: Field,
    blinding: Field,
    nullifier_seed: Field,
    collateral_randomness: Field,
    r: Field,
}

fn prove(w: Witness) {
    main(
        w.commitment,
        w.nullifier,
        w.market_id,
        w.participant_id,
        w.requested_quantity,
        w.min_price_per_quota,
        w.collateral_binding_x,
        w.collateral_binding_y,
        w.r_point_x,
        w.r_point_y,
        w.ciphertext_price,
        w.ciphertext_blinding,
        w.ciphertext_seed,
        w.config_hash_lo,
        w.config_hash_hi,
        w.price,
        w.blinding,
        w.nullifier_seed,
        w.collateral_randomness,
        w.r,
    );
}

fn ana(min_price: Field) -> Witness {
    witness(
        ANA_PRICE,
        min_price,
        ANA_MARKET_ID,
        ANA_PARTICIPANT_ID,
        ANA_QUANTITY,
        ANA_BLINDING,
        ANA_NULLIFIER_SEED,
        ANA_RANDOMNESS,
        ANA_R,
    )
}

fn witness(
    price: Field,
    min_price: Field,
    market_id: Field,
    participant_id: Field,
    quantity: Field,
    blinding: Field,
    nullifier_seed: Field,
    randomness: Field,
    r: Field,
) -> Witness {
    let c_a = pedersen::commit(price * quantity, randomness);
    let r_point = scalar_mul(EmbeddedCurvePoint::generator(), r);
    let s = scalar_mul(PK_OPERATOR, r);

    let mask_price = poseidon2::hash([BID_ENVELOPE_MASK_DOMAIN, s.x, s.y, 0]);
    let mask_blinding = poseidon2::hash([BID_ENVELOPE_MASK_DOMAIN, s.x, s.y, 1]);
    let mask_seed = poseidon2::hash([BID_ENVELOPE_MASK_DOMAIN, s.x, s.y, 2]);

    Witness {
        commitment: bid::commitment(price, market_id, participant_id, blinding, nullifier_seed),
        nullifier: bid::nullifier(nullifier_seed, market_id, participant_id),
        market_id,
        participant_id,
        requested_quantity: quantity,
        min_price_per_quota: min_price,
        collateral_binding_x: c_a.x,
        collateral_binding_y: c_a.y,
        r_point_x: r_point.x,
        r_point_y: r_point.y,
        ciphertext_price: price + mask_price,
        ciphertext_blinding: blinding + mask_blinding,
        ciphertext_seed: nullifier_seed + mask_seed,
        config_hash_lo: CONFIG_HASH_LO,
        config_hash_hi: CONFIG_HASH_HI,
        price,
        blinding,
        nullifier_seed,
        collateral_randomness: randomness,
        r,
    }
}

#[test]
fn valid_bid_is_accepted() {
    prove(ana(ANA_MIN_PRICE));
}

#[test]
fn price_at_the_floor_is_accepted() {
    prove(ana(ANA_PRICE));
}

#[test(should_fail)]
fn commitment_from_another_market_fails() {
    let mut w = ana(ANA_MIN_PRICE);
    w.market_id = ANA_MARKET_ID + 1;
    prove(w);
}

#[test(should_fail)]
fn commitment_from_another_participant_fails() {
    let mut w = ana(ANA_MIN_PRICE);
    w.participant_id = ANA_PARTICIPANT_ID + 1;
    prove(w);
}

#[test(should_fail)]
fn price_below_the_floor_fails() {
    prove(witness(
        400,
        500,
        ANA_MARKET_ID,
        ANA_PARTICIPANT_ID,
        ANA_QUANTITY,
        ANA_BLINDING,
        ANA_NULLIFIER_SEED,
        ANA_RANDOMNESS,
        ANA_R,
    ));
}

#[test(should_fail)]
fn price_zero_fails() {
    prove(witness(
        0,
        0,
        ANA_MARKET_ID,
        ANA_PARTICIPANT_ID,
        ANA_QUANTITY,
        ANA_BLINDING,
        ANA_NULLIFIER_SEED,
        ANA_RANDOMNESS,
        ANA_R,
    ));
}

#[test(should_fail)]
fn price_at_2_pow_63_fails() {
    prove(witness(
        9223372036854775808,
        0,
        ANA_MARKET_ID,
        ANA_PARTICIPANT_ID,
        ANA_QUANTITY,
        ANA_BLINDING,
        ANA_NULLIFIER_SEED,
        ANA_RANDOMNESS,
        ANA_R,
    ));
}

#[test(should_fail)]
fn collateral_of_another_value_fails() {
    let mut w = ana(ANA_MIN_PRICE);
    let other = pedersen::commit(ANA_PRICE * ANA_QUANTITY + 1, ANA_RANDOMNESS);
    w.collateral_binding_x = other.x;
    w.collateral_binding_y = other.y;
    prove(w);
}

#[test(should_fail)]
fn collateral_with_another_randomness_fails() {
    let mut w = ana(ANA_MIN_PRICE);
    let other = pedersen::commit(ANA_PRICE * ANA_QUANTITY, ANA_RANDOMNESS + 1);
    w.collateral_binding_x = other.x;
    w.collateral_binding_y = other.y;
    prove(w);
}

#[test(should_fail)]
fn envelope_with_altered_ciphertext_price_fails() {
    let mut w = ana(ANA_MIN_PRICE);
    w.ciphertext_price = w.ciphertext_price + 1;
    prove(w);
}

#[test(should_fail)]
fn envelope_for_another_key_fails() {
    let mut w = ana(ANA_MIN_PRICE);
    let r_point = scalar_mul(EmbeddedCurvePoint::generator(), ANA_R);

    w.ciphertext_price =
        ANA_PRICE + poseidon2::hash([BID_ENVELOPE_MASK_DOMAIN, r_point.x, r_point.y, 0]);
    w.ciphertext_blinding =
        ANA_BLINDING + poseidon2::hash([BID_ENVELOPE_MASK_DOMAIN, r_point.x, r_point.y, 1]);
    w.ciphertext_seed =
        ANA_NULLIFIER_SEED + poseidon2::hash([BID_ENVELOPE_MASK_DOMAIN, r_point.x, r_point.y, 2]);

    prove(w);
}

#[test(should_fail)]
fn nullifier_from_another_seed_fails() {
    let mut w = ana(ANA_MIN_PRICE);
    w.nullifier = bid::nullifier(ANA_NULLIFIER_SEED + 1, ANA_MARKET_ID, ANA_PARTICIPANT_ID);
    prove(w);
}

#[test]
fn commitment_matches_rf10_vector() {
    assert(
        bid::commitment(650, 42, 7, 111222333444, 999888777)
            == 0x02a90cb9c403c8001ce4bf3f4ed7376804d7101074cb1ebc42cdb13069136281,
    );
}

#[test]
fn pk_operator_is_the_documented_key() {
    let sk_operator: Field = 987654321098;
    let expected = scalar_mul(EmbeddedCurvePoint::generator(), sk_operator);
    assert(expected.x == PK_OPERATOR.x);
    assert(expected.y == PK_OPERATOR.y);
}
