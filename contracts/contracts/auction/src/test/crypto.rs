use soroban_sdk::{Bytes, BytesN, Env, Vec, U256};

use crate::crypto::{
    commitment, commitments_root, hash_limbs, point_fields, poseidon2_hash, u64_field,
    BID_COMMIT_DOMAIN, EMPTY_LEAF, MAX_BIDS,
};

fn be32(hex: &[u8; 64]) -> [u8; 32] {
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = (nibble(hex[2 * i]) << 4) | nibble(hex[2 * i + 1]);
    }
    out
}

fn nibble(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        _ => panic!("invalid hexadecimal"),
    }
}

fn n(e: &Env, v: u32) -> U256 {
    U256::from_u32(e, v)
}

fn n64(e: &Env, v: u64) -> U256 {
    U256::from_u128(e, v as u128)
}

fn raw(v: &U256) -> [u8; 32] {
    let mut out = [0u8; 32];
    v.to_be_bytes().copy_into_slice(&mut out);
    out
}

fn repeat<const N: usize>(e: &Env, v: u32) -> [U256; N] {
    core::array::from_fn(|_| n(e, v))
}

fn raw_bytes(b: &Bytes) -> [u8; 32] {
    let mut out = [0u8; 32];
    b.copy_into_slice(&mut out);
    out
}

#[test]
fn poseidon2_matches_noir_vectors() {
    let e = Env::default();

    let commitment = poseidon2_hash(
        &e,
        &[
            n(&e, 1001),
            n(&e, 650),
            n(&e, 42),
            n(&e, 7),
            n64(&e, 111222333444),
            n64(&e, 999888777),
        ],
    );
    assert_eq!(
        raw(&commitment),
        be32(b"02a90cb9c403c8001ce4bf3f4ed7376804d7101074cb1ebc42cdb13069136281")
    );

    let mask = poseidon2_hash(&e, &[n(&e, 1002), n(&e, 5), n(&e, 6), n(&e, 0)]);
    assert_eq!(
        raw(&mask),
        be32(b"21e3ac7533988800a82ff5c91e9ee5d7dd406c910488a117ca83e196f120ea52")
    );

    let full = poseidon2_hash(
        &e,
        &[
            n(&e, 1),
            n(&e, 2),
            n(&e, 3),
            n(&e, 4),
            n(&e, 5),
            n(&e, 6),
            n(&e, 7),
            n(&e, 8),
        ],
    );
    assert_eq!(
        raw(&full),
        be32(b"01dec21c6e1b30609eda618d7e35e5d9d6152f8fa67320d939c1a89603647142")
    );

    let short = poseidon2_hash(&e, &[n(&e, 1), n(&e, 2), n(&e, 3)]);
    assert_eq!(
        raw(&short),
        be32(b"23864adb160dddf590f1d3303683ebcb914f828e2635f6e85a32f0a1aecd3dd8")
    );
}

#[test]
fn commitment_matches_noir_vector() {
    let e = Env::default();

    let c = commitment(&e, 650, 42, 7, 111222333444, 999888777);

    assert_eq!(
        c.to_array(),
        be32(b"02a90cb9c403c8001ce4bf3f4ed7376804d7101074cb1ebc42cdb13069136281")
    );

    assert_ne!(
        commitment(&e, 650, 42, 7, 111222333444, 999888778),
        c,
        "nullifier_seed did not enter"
    );
    assert_ne!(
        commitment(&e, 650, 42, 7, 111222333445, 999888777),
        c,
        "blinding did not enter"
    );
    assert_ne!(
        commitment(&e, 650, 43, 7, 111222333444, 999888777),
        c,
        "market_id did not enter"
    );
    assert_ne!(
        commitment(&e, 650, 42, 8, 111222333444, 999888777),
        c,
        "participant_id did not enter"
    );
    assert_ne!(
        commitment(&e, 651, 42, 7, 111222333444, 999888777),
        c,
        "price did not enter"
    );
}

#[test]
fn root_of_empty_market_is_all_empty_leaves() {
    let e = Env::default();

    let root = commitments_root(&e, &Vec::new(&e));

    assert_eq!(
        root.to_array(),
        be32(b"036f719372f750af472b51b3560fde722f75b24a068ca6329e2f86ac08e53e46")
    );

    let expected = poseidon2_hash(&e, &repeat::<{ MAX_BIDS as usize }>(&e, EMPTY_LEAF as u32));
    assert_eq!(raw(&expected), root.to_array());
}

#[test]
fn root_matches_poc4_vector() {
    let e = Env::default();

    let prices: [u32; MAX_BIDS as usize] = [650, 620, 600, 590, 580, 580, 570, 560];
    let blindings: [u32; MAX_BIDS as usize] = [111, 222, 333, 444, 555, 666, 777, 888];

    let mut commitments = Vec::new(&e);
    for i in 0..MAX_BIDS as usize {
        let c = poseidon2_hash(
            &e,
            &[
                n(&e, BID_COMMIT_DOMAIN as u32),
                n(&e, prices[i]),
                n(&e, blindings[i]),
            ],
        );
        commitments.push_back(BytesN::from_array(&e, &raw(&c)));
    }

    assert_eq!(
        commitments.get(0).unwrap().to_array(),
        be32(b"185a3b8ad07f1deeb62410aa47c714ca42538ee8d85c5a9a1b3e72fa23018312")
    );

    let root = commitments_root(&e, &commitments);
    assert_eq!(
        root.to_array(),
        be32(b"2e5b8224814161a1d1313cd1be541cf4e88be94709870fad92d789398bf7efce")
    );
}

#[test]
fn u64_field_is_32_bytes_big_endian() {
    let e = Env::default();
    let b = u64_field(&e, 0x0102_0304_0506_0708);
    assert_eq!(b.len(), 32);
    let r = raw_bytes(&b);
    assert_eq!(r[0..24], [0u8; 24]);
    assert_eq!(r[24..32], [1, 2, 3, 4, 5, 6, 7, 8]);

    assert_eq!(U256::from_be_bytes(&e, &b), n64(&e, 0x0102_0304_0506_0708));
}

#[test]
fn point_fields_splits_x_then_y() {
    let e = Env::default();

    let mut point = [0u8; 64];
    for i in 0..32 {
        point[i] = (i as u8) + 1;
        point[32 + i] = (i as u8) + 0x80;
    }

    let out = point_fields(&e, &BytesN::from_array(&e, &point));
    assert_eq!(out.len(), 64);

    let mut r = [0u8; 64];
    out.copy_into_slice(&mut r);
    assert_eq!(r[0..32], point[0..32]);
    assert_eq!(r[32..64], point[32..64]);
    assert_ne!(r[0..32], r[32..64]);
}

#[test]
fn hash_limbs_hi_is_first_16_bytes() {
    let e = Env::default();
    let mut hash = [0u8; 32];
    for (i, byte) in hash.iter_mut().enumerate() {
        *byte = i as u8;
    }

    let (lo, hi) = hash_limbs(&e, &BytesN::from_array(&e, &hash));
    let lo = raw_bytes(&lo);
    let hi = raw_bytes(&hi);

    assert_eq!(hi[0..16], [0u8; 16]);
    assert_eq!(hi[16..32], hash[0..16], "hi is the FIRST half of the hash");
    assert_eq!(lo[0..16], [0u8; 16]);
    assert_eq!(lo[16..32], hash[16..32], "lo is the second half");

    assert_ne!(lo, hi);
}

#[test]
fn root_cost_is_recorded() {
    let e = Env::default();

    let mut commitments = Vec::new(&e);
    for i in 0..MAX_BIDS {
        let mut c = [0u8; 32];
        c[31] = (i as u8) + 1;
        commitments.push_back(BytesN::from_array(&e, &c));
    }

    let mut budget = e.cost_estimate().budget();
    budget.reset_unlimited();
    let _ = commitments_root(&e, &commitments);
    let cpu = budget.cpu_instruction_cost();

    std::println!("commitments_root with {MAX_BIDS} bids: {cpu} CPU instructions");

    assert!(cpu > 0);
}
