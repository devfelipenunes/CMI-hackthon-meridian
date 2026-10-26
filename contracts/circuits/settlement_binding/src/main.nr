use cmi_lib::bid;
use cmi_lib::pedersen;

fn house_fee(gross: Field, fee_bps: Field, fee: Field, fee_rem: Field) {
    fee.assert_max_bit_size::<127>();
    fee_rem.assert_max_bit_size::<14>();
    assert((fee_rem as u64) < 10000);
    assert(fee * 10000 + fee_rem == gross * fee_bps);
}

fn main(
    bid_commitment: pub Field,
    requested_quantity: pub Field,
    filled_quantity: pub Field,
    fee_bps: pub Field,
    c_seller_x: pub Field,
    c_seller_y: pub Field,
    c_fee_x: pub Field,
    c_fee_y: pub Field,
    c_refund_x: pub Field,
    c_refund_y: pub Field,
    price: Field,
    market_id: Field,
    participant_id: Field,
    blinding: Field,
    nullifier_seed: Field,
    fee: Field,
    fee_rem: Field,
    r_seller: Field,
    r_fee: Field,
    r_refund: Field,
) {
    let computed = bid::commitment(price, market_id, participant_id, blinding, nullifier_seed);
    assert(computed == bid_commitment);

    requested_quantity.assert_max_bit_size::<64>();
    filled_quantity.assert_max_bit_size::<64>();
    let unfilled = requested_quantity - filled_quantity;
    unfilled.assert_max_bit_size::<64>();
    price.assert_max_bit_size::<63>();
    fee_bps.assert_max_bit_size::<14>();
    assert((fee_bps as u64) <= 10000);

    let gross = price * filled_quantity;
    house_fee(gross, fee_bps, fee, fee_rem);

    let c_seller = pedersen::commit(gross - fee, r_seller);
    assert(c_seller.x == c_seller_x);
    assert(c_seller.y == c_seller_y);

    let c_fee = pedersen::commit(fee, r_fee);
    assert(c_fee.x == c_fee_x);
    assert(c_fee.y == c_fee_y);

    let c_refund = pedersen::commit(price * unfilled, r_refund);
    assert(c_refund.x == c_refund_x);
    assert(c_refund.y == c_refund_y);
}

global MARKET_ID: Field = 42;
global PARTICIPANT_ID: Field = 7;
global BLINDING: Field = 111222333444;
global NULLIFIER_SEED: Field = 999888777;
global FEE_BPS: Field = 1000;
global BID_COMMITMENT: Field = 0x02a90cb9c403c8001ce4bf3f4ed7376804d7101074cb1ebc42cdb13069136281;

struct Scenario {
    bid_commitment: Field,
    requested_quantity: u64,
    filled_quantity: u64,
    price: u64,
    fee: Field,
    fee_rem: Field,
    c_seller_x: Field,
    c_seller_y: Field,
    c_fee_x: Field,
    c_fee_y: Field,
    c_refund_x: Field,
    c_refund_y: Field,
    r_seller: Field,
    r_fee: Field,
    r_refund: Field,
}

fn prove(s: Scenario) {
    main(
        s.bid_commitment,
        s.requested_quantity as Field,
        s.filled_quantity as Field,
        FEE_BPS,
        s.c_seller_x,
        s.c_seller_y,
        s.c_fee_x,
        s.c_fee_y,
        s.c_refund_x,
        s.c_refund_y,
        s.price as Field,
        MARKET_ID,
        PARTICIPANT_ID,
        BLINDING,
        NULLIFIER_SEED,
        s.fee,
        s.fee_rem,
        s.r_seller,
        s.r_fee,
        s.r_refund,
    );
}

fn partial() -> Scenario {
    Scenario {
        bid_commitment: BID_COMMITMENT,
        requested_quantity: 200,
        filled_quantity: 120,
        price: 650,
        fee: 7800,
        fee_rem: 0,
        c_seller_x: 0x0de8e2dd6bd6648ad7bdbe4e8a01476e60d6ba15ff17277d43931830373f107f,
        c_seller_y: 0x07822c92e5b5ffb67e3bc858007947e2a63ca3ebbc948e2bc93abeaf9344b2d9,
        c_fee_x: 0x2b0609da67be8fab6d9e49bde87c77466b7c76907c742f2f9cfd6f22d2e6167e,
        c_fee_y: 0x1dce4c81d44a6969fa2b8c4019e3608999311c67fe8de1643bbdeda556a8bfef,
        c_refund_x: 0x285d9d8642ff5455683c9cc1fc16564db9d31707f72a585876bc7d2534349ffc,
        c_refund_y: 0x1081881e540b140909a322187523104cb2d41769691f244eb36f9502c0c63491,
        r_seller: 111222333444,
        r_fee: 222333444555,
        r_refund: 333444555666,
    }
}

fn full() -> Scenario {
    Scenario {
        bid_commitment: BID_COMMITMENT,
        requested_quantity: 200,
        filled_quantity: 200,
        price: 650,
        fee: 13000,
        fee_rem: 0,
        c_seller_x: 0x1d054e100e9d2846023c6ce56426ddf63f36bd113a69bc88d02de9867121a713,
        c_seller_y: 0x25d2f658fb52854aac505dbf190c0624a81bc80fa36ef8a6a5353b81b1c9399f,
        c_fee_x: 0x00eac8c712d3112037ba9790ae2c2f001cf37b01873fc1140b4bb00138307874,
        c_fee_y: 0x012010ae5dc014854956bc9381d22e644e74be094a02976fa1edc7bb899033e1,
        c_refund_x: 0x1e543fb9b50198c7c2aa2012ca379b0c09b53fc2ea787b23648bba27095a4b0a,
        c_refund_y: 0x1436073d1366cae063424e6cb369e7b8a9792df8adbbf7e4feafee595a72047c,
        r_seller: 444555666777,
        r_fee: 555666777888,
        r_refund: 666777888999,
    }
}

fn zero() -> Scenario {
    Scenario {
        bid_commitment: BID_COMMITMENT,
        requested_quantity: 200,
        filled_quantity: 0,
        price: 650,
        fee: 0,
        fee_rem: 0,
        c_seller_x: 0x1e62e29faec267a4b27b8f9cfa143165f7e6cc6e9c0f9766254996f573b1a443,
        c_seller_y: 0x26b07562e46af82bad34dc1b946c4c37ba243be674919e5bc072c888af71b4f5,
        c_fee_x: 0x1c854020dbf6e748e336e828d3b956dd0dffd10ded0a0818a9d7f050b339ffcd,
        c_fee_y: 0x01bd1228ca42874543513d7bae932a713b8a6b89b1a625be9ad9f50822c2e18b,
        c_refund_x: 0x09047258f3947872b4001a97ab88d2f7a667b153f09849748fd41a1c1f19966e,
        c_refund_y: 0x08a1d9502f3ffd1eda94f88509bcda2066368fc50e855206ab1826a6979897f3,
        r_seller: 777888999000,
        r_fee: 888999000111,
        r_refund: 999000111222,
    }
}

fn rounding() -> Scenario {
    Scenario {
        bid_commitment: 0x29689682864ad721e98233a39c5cbcce1061e3b7dc39a5905754cf88b8fca2b6,
        requested_quantity: 200,
        filled_quantity: 1,
        price: 65,
        fee: 6,
        fee_rem: 5000,
        c_seller_x: 0x0dfba7b5d3792fa1e0b65d4abfe60ce574e911d32a21bf4ef65c20f6f7232277,
        c_seller_y: 0x281bafe180e0b37a3672486c6d744ec72755eaab400600ad0b1f629789f9ca44,
        c_fee_x: 0x2fc3a88df5a227d5fa85baa0d2fbd22374ef347c35764c627e8525176db052e6,
        c_fee_y: 0x04c75afca4251346b5453a14f88e47abaef5290d362c708ee609c8b35a765265,
        c_refund_x: 0x0ea376ebb593fa5926661832aba978f4ffb215889cd40cccb8e398e33be395f0,
        c_refund_y: 0x2a0fc11eb2b635a1ba4b7bc72cb1d19ba2017cd7884ae2b14f8c7a3c99dfa382,
        r_seller: 121314151617,
        r_fee: 181920212223,
        r_refund: 242526272829,
    }
}

#[test]
fn partial_fill_binds_the_three_legs() {
    prove(partial());
}

#[test]
fn full_fill_leaves_no_refund() {
    prove(full());
}

#[test]
fn zero_fill_leaves_the_whole_escrow_to_the_bidder() {
    prove(zero());
}

#[test]
fn rounding_floors_the_fee() {
    prove(rounding());
}

#[test(should_fail)]
fn skipped_fee_is_rejected() {
    let mut s = partial();
    s.fee = 0;
    s.fee_rem = 78000000;
    prove(s);
}

#[test(should_fail)]
fn twenty_percent_fee_is_rejected() {
    let mut s = partial();
    s.fee = 15600;
    s.fee_rem = 0;
    prove(s);
}

#[test(should_fail)]
fn seller_taking_the_whole_gross_is_rejected() {
    let mut s = partial();
    s.c_seller_x = 0x0b3c10082496deb9bfb17dbf62431e7a1da06f91627ce4818479b1bb6cff7009;
    s.c_seller_y = 0x20b227c102ce0b782522d36f65569155540b299f5ce8b3b969940dcfd753a5d7;
    prove(s);
}

#[test(should_fail)]
fn refund_one_unit_too_large_is_rejected() {
    let mut s = partial();
    s.c_refund_x = 0x043c517d1a61fa378da546612382d8e23e08bd38f8243cfc76b395f905ef99aa;
    s.c_refund_y = 0x221c8e8cb6b9a59dc4a21eabe2ccac4980c69574cee38988d7554c71962b2acb;
    prove(s);
}

#[test(should_fail)]
fn filled_above_requested_is_rejected() {
    let mut s = partial();
    s.filled_quantity = 201;
    prove(s);
}

#[test(should_fail)]
fn commitment_of_another_price_is_rejected() {
    let mut s = partial();
    s.price = 651;
    prove(s);
}

#[test(should_fail)]
fn remainder_at_the_boundary_is_rejected() {
    house_fee(78000, 1000, 7799, 10000);
}

#[test]
fn house_fee_is_the_floor_of_ten_percent() {
    house_fee(78000, 1000, 7800, 0);
    house_fee(65, 1000, 6, 5000);
}

#[test(should_fail)]
fn house_fee_rejects_a_wrong_fee() {
    house_fee(78000, 1000, 7801, 0);
}

#[test(should_fail)]
fn house_fee_rejects_an_out_of_range_remainder() {
    house_fee(78000, 1000, 7799, 10000);
}
