mod bidding;
mod crypto;
mod fakes;
mod market;
mod queries;
mod settlement;
mod setup;
mod ttl;
mod wasm;

use soroban_sdk::xdr::{ContractEvent, ContractEventBody, ScVal};
use soroban_sdk::{Address, Env, Symbol, TryFromVal, Val, Vec};

use shared::types::MarketStatus;

pub(crate) fn invoke<T>(e: &Env, addr: &Address, fn_name: &str) -> T
where
    T: TryFromVal<Env, Val>,
{
    e.invoke_contract(addr, &Symbol::new(e, fn_name), Vec::new(e))
}

#[test]
fn auction_registers_in_env() {
    let world = setup::new_world();

    assert_eq!(
        invoke::<MarketStatus>(&world.e, &world.auction, "get_state"),
        MarketStatus::Created
    );
}

pub(crate) fn leaks_in(e: &Env, val: &ScVal, secretos: &[i128]) -> std::vec::Vec<i128> {
    match val {
        ScVal::U32(v) => hit(*v as i128, secretos),
        ScVal::I32(v) => hit(*v as i128, secretos),
        ScVal::U64(v) => hit(*v as i128, secretos),
        ScVal::I64(v) => hit(*v as i128, secretos),
        ScVal::U128(parts) => hit(((parts.hi as i128) << 64) | parts.lo as i128, secretos),
        ScVal::I128(parts) => hit(
            (parts.hi as i128) * (1i128 << 64) + parts.lo as i128,
            secretos,
        ),
        ScVal::Bytes(bytes) => secretos
            .iter()
            .copied()
            .filter(|s| contains_field(e, bytes.0.as_vec(), *s))
            .collect(),
        ScVal::Vec(Some(items)) => items
            .iter()
            .flat_map(|item| leaks_in(e, item, secretos))
            .collect(),
        ScVal::Map(Some(entries)) => entries
            .iter()
            .flat_map(|entry| {
                let mut found = leaks_in(e, &entry.key, secretos);
                found.extend(leaks_in(e, &entry.val, secretos));
                found
            })
            .collect(),
        _ => std::vec::Vec::new(),
    }
}

fn hit(v: i128, secretos: &[i128]) -> std::vec::Vec<i128> {
    secretos.iter().copied().filter(|s| *s == v).collect()
}

fn contains_field(e: &Env, haystack: &[u8], value: i128) -> bool {
    if value < 0 || value > u64::MAX as i128 {
        return false;
    }

    let mut needle = [0u8; 32];
    crate::crypto::u64_field(e, value as u64).copy_into_slice(&mut needle);

    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

pub(crate) fn assert_no_price_leak(e: &Env, events: &[ContractEvent], secretos: &[i128]) {
    for (i, event) in events.iter().enumerate() {
        let ContractEventBody::V0(body) = &event.body;

        for (topic_index, topic) in body.topics.iter().enumerate() {
            let found = leaks_in(e, topic, secretos);
            assert!(
                found.is_empty(),
                "event {i} carries {found:?} in clear on topic {topic_index}"
            );
        }

        let found = leaks_in(e, &body.data, secretos);
        assert!(
            found.is_empty(),
            "event {i} carries {found:?} in clear in the data"
        );
    }
}
