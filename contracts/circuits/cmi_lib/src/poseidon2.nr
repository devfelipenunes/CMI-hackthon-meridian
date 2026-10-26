use std::hash::poseidon2_permutation;

pub fn hash<let N: u32>(inputs: [Field; N]) -> Field {
    let two_pow_64: Field = 18446744073709551616;
    let in_len: Field = N as Field;
    let iv: Field = in_len * two_pow_64;
    let mut state: [Field; 4] = [0, 0, 0, iv];
    let mut cache_size: u32 = 0;
    for i in 0..N {
        if cache_size == 3 {
            state = poseidon2_permutation(state, 4);
            state[0] = state[0] + inputs[i];
            cache_size = 1;
        } else {
            state[cache_size] = state[cache_size] + inputs[i];
            cache_size += 1;
        }
    }
    let final_state = poseidon2_permutation(state, 4);
    final_state[0]
}

#[test]
fn poseidon2_matches_confidential_token_sponge() {
    assert(
        hash([1001, 650, 42, 7, 111222333444, 999888777])
            == 0x02a90cb9c403c8001ce4bf3f4ed7376804d7101074cb1ebc42cdb13069136281,
    );
    assert(
        hash([1002, 5, 6, 0]) == 0x21e3ac7533988800a82ff5c91e9ee5d7dd406c910488a117ca83e196f120ea52,
    );
    assert(
        hash([1, 2, 3, 4, 5, 6, 7, 8])
            == 0x01dec21c6e1b30609eda618d7e35e5d9d6152f8fa67320d939c1a89603647142,
    );
    assert(hash([1, 2, 3]) == 0x23864adb160dddf590f1d3303683ebcb914f828e2635f6e85a32f0a1aecd3dd8);
}
