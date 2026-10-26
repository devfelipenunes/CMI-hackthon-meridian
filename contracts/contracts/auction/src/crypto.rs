use soroban_poseidon::{poseidon2_hash as poseidon2_hash_raw, Poseidon2Sponge};
use soroban_sdk::crypto::bn254::Bn254Fr;
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{panic_with_error, Bytes, BytesN, Env, Vec, U256};

use crate::types::{AuctionError, BidEnvelope, MarketConfig};

pub use crate::types::{
    BID_COMMIT_DOMAIN, BID_ENVELOPE_MASK_DOMAIN, BID_LEAF_DOMAIN, EMPTY_LEAF, MAX_BIDS,
    NULLIFIER_DOMAIN,
};

fn fe(e: &Env, v: u64) -> U256 {
    U256::from_u128(e, v as u128)
}

fn commitment_fe(e: &Env, commitment: &BytesN<32>) -> U256 {
    U256::from_be_bytes(e, &Bytes::from_array(e, &commitment.to_array()))
}

fn leaf_inputs(e: &Env, bid_index: u32, commitment: &BytesN<32>) -> Vec<U256> {
    let mut inputs = Vec::new(e);
    inputs.push_back(fe(e, BID_LEAF_DOMAIN));
    inputs.push_back(fe(e, bid_index as u64));
    inputs.push_back(commitment_fe(e, commitment));
    inputs
}

#[cfg(any(test, feature = "testutils"))]
fn commitment_inputs(
    e: &Env,
    price: u64,
    market_id: u64,
    participant_id: u32,
    blinding: u64,
    nullifier_seed: u64,
) -> Vec<U256> {
    let mut inputs = Vec::new(e);
    inputs.push_back(fe(e, BID_COMMIT_DOMAIN));
    inputs.push_back(fe(e, price));
    inputs.push_back(fe(e, market_id));
    inputs.push_back(fe(e, participant_id as u64));
    inputs.push_back(fe(e, blinding));
    inputs.push_back(fe(e, nullifier_seed));
    inputs
}

pub fn poseidon2_hash(e: &Env, inputs: &[U256]) -> U256 {
    let mut inputs_vec = Vec::new(e);
    for input in inputs.iter() {
        inputs_vec.push_back(input.clone());
    }
    poseidon2_hash_raw::<4, Bn254Fr>(e, &inputs_vec)
}

pub fn leaf(e: &Env, bid_index: u32, commitment: &BytesN<32>) -> U256 {
    poseidon2_hash_raw::<4, Bn254Fr>(e, &leaf_inputs(e, bid_index, commitment))
}

#[cfg(any(test, feature = "testutils"))]
pub fn commitment(
    e: &Env,
    price: u64,
    market_id: u64,
    participant_id: u32,
    blinding: u64,
    nullifier_seed: u64,
) -> BytesN<32> {
    let hash = poseidon2_hash_raw::<4, Bn254Fr>(
        e,
        &commitment_inputs(
            e,
            price,
            market_id,
            participant_id,
            blinding,
            nullifier_seed,
        ),
    );
    let mut out = [0u8; 32];
    hash.to_be_bytes().copy_into_slice(&mut out);
    BytesN::from_array(e, &out)
}

pub fn commitments_root(e: &Env, commitments: &Vec<BytesN<32>>) -> BytesN<32> {
    let n = commitments.len();
    assert!(
        n <= MAX_BIDS,
        "commitments_root: more than MAX_BIDS commitments"
    );

    let mut sponge = Poseidon2Sponge::<4, Bn254Fr>::new(e);
    let empty = fe(e, EMPTY_LEAF);

    let mut leaves = Vec::new(e);
    for (i, commitment) in commitments.iter().enumerate() {
        let inputs = leaf_inputs(e, i as u32, &commitment);
        leaves.push_back(sponge.compute_hash(&inputs));
    }
    for _ in n..MAX_BIDS {
        leaves.push_back(empty.clone());
    }

    let root = sponge.compute_hash(&leaves);
    let mut out = [0u8; 32];
    root.to_be_bytes().copy_into_slice(&mut out);
    BytesN::from_array(e, &out)
}

pub fn u32_field(e: &Env, v: u32) -> Bytes {
    let mut out = [0u8; 32];
    out[28..32].copy_from_slice(&v.to_be_bytes());
    Bytes::from_array(e, &out)
}

pub fn u64_field(e: &Env, v: u64) -> Bytes {
    let mut out = [0u8; 32];
    out[24..32].copy_from_slice(&v.to_be_bytes());
    Bytes::from_array(e, &out)
}

pub fn point_fields(e: &Env, p: &BytesN<64>) -> Bytes {
    let raw = p.to_array();
    let mut out = [0u8; 64];
    out.copy_from_slice(&raw);
    Bytes::from_array(e, &out)
}

pub fn config_hash(e: &Env, config: &MarketConfig) -> BytesN<32> {
    e.crypto().sha256(&config.clone().to_xdr(e)).to_bytes()
}

pub struct BidValidityInputs<'a> {
    pub commitment: &'a BytesN<32>,

    pub nullifier: &'a BytesN<32>,

    pub market_id: u64,

    pub participant_id: u32,

    pub requested_quantity: u32,

    pub min_price_per_quota: u64,

    pub collateral_binding: &'a BytesN<64>,

    pub envelope: &'a BidEnvelope,

    pub config_hash: &'a BytesN<32>,
}

pub fn bid_validity_inputs(e: &Env, inputs: &BidValidityInputs) -> Bytes {
    let (config_hash_lo, config_hash_hi) = hash_limbs(e, inputs.config_hash);

    let mut out = Bytes::new(e);
    out.append(&Bytes::from_array(e, &inputs.commitment.to_array()));
    out.append(&Bytes::from_array(e, &inputs.nullifier.to_array()));
    out.append(&u64_field(e, inputs.market_id));
    out.append(&u32_field(e, inputs.participant_id));
    out.append(&u32_field(e, inputs.requested_quantity));
    out.append(&u64_field(e, inputs.min_price_per_quota));
    out.append(&point_fields(e, inputs.collateral_binding));
    out.append(&point_fields(e, &inputs.envelope.r_point));
    out.append(&Bytes::from_array(e, &inputs.envelope.ct_price.to_array()));
    out.append(&Bytes::from_array(
        e,
        &inputs.envelope.ct_blinding.to_array(),
    ));
    out.append(&Bytes::from_array(e, &inputs.envelope.ct_seed.to_array()));
    out.append(&config_hash_lo);
    out.append(&config_hash_hi);
    out
}

pub struct AllocationInputs<'a> {
    pub commitments_root: &'a BytesN<32>,

    pub requested_quantities: &'a Vec<u32>,

    pub filled_quantities: &'a Vec<u32>,

    pub bid_count: u32,

    pub total_supply: u32,

    pub market_id: u64,

    pub auction_rule: u32,

    pub config_hash: &'a BytesN<32>,
}

pub fn allocation_inputs(e: &Env, inputs: &AllocationInputs) -> Bytes {
    let (config_hash_lo, config_hash_hi) = hash_limbs(e, inputs.config_hash);

    let mut out = Bytes::new(e);
    out.append(&Bytes::from_array(e, &inputs.commitments_root.to_array()));

    for i in 0..MAX_BIDS {
        let requested = padded(e, inputs.requested_quantities, i, inputs.bid_count);
        out.append(&u64_field(e, requested));
    }

    for i in 0..MAX_BIDS {
        let filled = padded(e, inputs.filled_quantities, i, inputs.bid_count);
        out.append(&u64_field(e, filled));
    }

    out.append(&u32_field(e, inputs.bid_count));
    out.append(&u64_field(e, inputs.total_supply as u64));
    out.append(&u64_field(e, inputs.market_id));
    out.append(&u64_field(e, inputs.auction_rule as u64));
    out.append(&config_hash_lo);
    out.append(&config_hash_hi);
    out
}

fn padded(e: &Env, quantities: &Vec<u32>, i: u32, bid_count: u32) -> u64 {
    if i >= bid_count {
        return 0;
    }
    match quantities.get(i) {
        Some(q) => q as u64,
        None => panic_with_error!(e, AuctionError::InvalidAllocationLength),
    }
}

pub fn hash_limbs(e: &Env, h: &BytesN<32>) -> (Bytes, Bytes) {
    let raw = h.to_array();

    let mut hi = [0u8; 32];
    hi[16..32].copy_from_slice(&raw[0..16]);

    let mut lo = [0u8; 32];
    lo[16..32].copy_from_slice(&raw[16..32]);

    (Bytes::from_array(e, &lo), Bytes::from_array(e, &hi))
}

pub struct SettlementInputs<'a> {
    pub bid_commitment: &'a BytesN<32>,

    pub requested_quantity: u32,

    pub filled_quantity: u32,

    pub fee_bps: u32,

    pub c_seller: &'a BytesN<64>,

    pub c_fee: &'a BytesN<64>,

    pub c_refund: &'a BytesN<64>,
}

pub fn settlement_inputs(e: &Env, inputs: &SettlementInputs) -> Bytes {
    let mut out = Bytes::new(e);
    out.append(&Bytes::from_array(e, &inputs.bid_commitment.to_array()));
    out.append(&u32_field(e, inputs.requested_quantity));
    out.append(&u32_field(e, inputs.filled_quantity));
    out.append(&u32_field(e, inputs.fee_bps));
    out.append(&point_fields(e, inputs.c_seller));
    out.append(&point_fields(e, inputs.c_fee));
    out.append(&point_fields(e, inputs.c_refund));
    out
}
