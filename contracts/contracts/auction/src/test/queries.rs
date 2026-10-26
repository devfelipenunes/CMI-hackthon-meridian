use shared::types::{
    BidEnvelope, BidRecord, BidStatus, BidSubmission, MarketConfig, MarketStatus,
    FINALIZATION_GRACE_LEDGERS, MIN_FEE_RESERVE, REIMBURSEMENT_PER_CALL,
};
use soroban_sdk::testutils::storage::{Instance as _, Persistent as _};
use soroban_sdk::testutils::{Address as _, Events as _};
use soroban_sdk::xdr::{ContractEvent, ContractEventBody, ScVal};
use soroban_sdk::{vec, Address, Bytes, BytesN, Env, IntoVal, Map, Symbol, TryFromVal, Val, Vec};

use crate::crypto;
use crate::types::{AuctionError, DataKey};

use super::bidding;
use super::market::{
    a_finalize_proof, allocation_of, at_ledger, at_timeout, bid_count_of, bid_record_of,
    cancel_expired, close, close_ledger, config_hash_of, config_of, fee_reserve_of, finalize,
    finalize_by_of, funded_world, market_state, open, quantities, root_of,
};
use super::settlement::{settle, settlement_status_of};
use super::setup;

const PRICES: [u64; 3] = [1_500, 1_800, 2_100];

const REQUESTED: [u32; 3] = [4, 4, 2];

const FILLED: [u32; 3] = [4, 0, 0];

fn plantados() -> std::vec::Vec<i128> {
    let mut out: std::vec::Vec<i128> = PRICES.iter().map(|price| *price as i128).collect();
    out.sort_unstable();
    out
}

fn secretos() -> std::vec::Vec<i128> {
    let mut out = std::vec::Vec::new();

    for i in 0..PRICES.len() {
        let price = PRICES[i] as i128;
        let requested = REQUESTED[i] as i128;
        let filled = FILLED[i] as i128;

        out.extend([
            price,
            price * requested,
            price * filled,
            price * (requested - filled),
        ]);
    }

    out.retain(|value| *value > 0);
    out.sort_unstable();
    out.dedup();
    out
}

fn closed_with_prices() -> (setup::World, Vec<Address>, std::vec::Vec<ContractEvent>) {
    let w = funded_world();
    let mut log = std::vec::Vec::new();

    open(&w);
    collect_into(&w, &mut log);

    let mut bidders = Vec::new(&w.e);
    for (i, price) in PRICES.iter().enumerate() {
        let (bidder, events) = bidder_at_price(&w, *price, REQUESTED[i], (i + 1) as u8);

        bidders.push_back(bidder);
        log.extend(events);
    }

    at_ledger(&w, close_ledger(&w));
    close(&w, &Address::generate(&w.e));
    collect_into(&w, &mut log);

    (w, bidders, log)
}

fn a_full_auction() -> (setup::World, Vec<Address>, std::vec::Vec<ContractEvent>) {
    let (w, bidders, mut log) = closed_with_prices();

    finalize(
        &w,
        &Address::generate(&w.e),
        &quantities(&w, &FILLED),
        &a_finalize_proof(&w),
    );
    collect_into(&w, &mut log);

    for bid_index in 0..REQUESTED.len() as u32 {
        settle(&w, &Address::generate(&w.e), bid_index);
        collect_into(&w, &mut log);
    }

    (w, bidders, log)
}

fn collect_into(w: &setup::World, into: &mut std::vec::Vec<ContractEvent>) {
    let emitted = w.e.events().all().filter_by_contract(&w.auction);
    for event in emitted.events() {
        into.push(event.clone());
    }
}

fn bidder_at_price(
    w: &setup::World,
    price: u64,
    requested: u32,
    seed: u8,
) -> (Address, std::vec::Vec<ContractEvent>) {
    let bidder = Address::generate(&w.e);
    let config = config_of(w);
    let mut events = std::vec::Vec::new();

    let participant_id = bidding::register(w, &bidder);
    collect_into(w, &mut events);

    let mut ct_price = [0u8; 32];
    crypto::u64_field(&w.e, price).copy_into_slice(&mut ct_price);

    bidding::submit(
        w,
        &bidder,
        &BidSubmission {
            requested_quantity: requested,
            commitment: crypto::commitment(
                &w.e,
                price,
                config.market_id,
                participant_id,
                seed as u64,
                seed as u64 + 1,
            ),

            nullifier: BytesN::from_array(&w.e, &[seed.wrapping_add(0x40); 32]),
            envelope: BidEnvelope {
                r_point: BytesN::from_array(&w.e, &[seed; 64]),
                ct_price: BytesN::from_array(&w.e, &ct_price),
                ct_blinding: BytesN::from_array(&w.e, &[seed; 32]),
                ct_seed: BytesN::from_array(&w.e, &[seed; 32]),
            },
            proof: Bytes::from_array(&w.e, &[seed; 8]),
        },
    );
    collect_into(w, &mut events);

    (bidder, events)
}

fn env_storage(w: &setup::World) -> std::vec::Vec<(std::string::String, ScVal)> {
    let mut entries = std::vec::Vec::new();

    w.e.as_contract(&w.auction, || {
        for (key, value) in w.e.storage().instance().all().iter() {
            entries.push((entry_label(&w.e, "instance", &key), scval(&w.e, &value)));
        }

        for (key, value) in w.e.storage().persistent().all().iter() {
            entries.push((entry_label(&w.e, "persistent", &key), scval(&w.e, &value)));
        }
    });

    entries.sort_by(|a, b| a.0.cmp(&b.0));
    entries
}

fn entry_label(e: &Env, durability: &str, key: &Val) -> std::string::String {
    std::format!("{durability}/{:?}", scval(e, key))
}

fn scval(e: &Env, value: &Val) -> ScVal {
    ScVal::try_from_val(e, value).expect("the storage entry did not convert to ScVal")
}

fn as_scval<T: IntoVal<Env, Val>>(e: &Env, value: T) -> ScVal {
    ScVal::try_from_val(e, &value.into_val(e)).expect("the value did not convert to ScVal")
}

fn storage_leaks(
    e: &Env,
    entries: &[(std::string::String, ScVal)],
    secretos: &[i128],
) -> std::vec::Vec<(std::string::String, i128)> {
    let mut found = std::vec::Vec::new();

    for (label, value) in entries {
        for hit in super::leaks_in(e, value, secretos) {
            found.push((label.clone(), hit));
        }
    }

    found
}

struct Canonical {
    state: MarketStatus,
    bid_count: u32,

    config_hash: bool,

    rooted: bool,

    finalize_by: Option<u32>,

    reserve: i128,

    allocation: std::vec::Vec<u32>,

    statuses: std::vec::Vec<BidStatus>,

    filled: std::vec::Vec<u32>,
}

fn canonical(w: &setup::World, state: MarketStatus, placed: u32) -> Canonical {
    let bids = placed as usize;
    let finalize_by = Some(config_of(w).params.close_ledger + FINALIZATION_GRACE_LEDGERS);

    match state {
        MarketStatus::Created => Canonical {
            state,
            bid_count: 0,

            config_hash: false,
            rooted: false,
            finalize_by: None,
            reserve: MIN_FEE_RESERVE,
            allocation: std::vec![],
            statuses: std::vec![],
            filled: std::vec![],
        },
        MarketStatus::Open => Canonical {
            state,
            bid_count: placed,
            config_hash: true,
            rooted: false,
            finalize_by: None,
            reserve: MIN_FEE_RESERVE,
            allocation: std::vec![],
            statuses: std::vec![BidStatus::Pending; bids],
            filled: std::vec![0; bids],
        },
        MarketStatus::Closed => Canonical {
            state,
            bid_count: placed,
            config_hash: true,
            rooted: true,
            finalize_by,

            reserve: MIN_FEE_RESERVE - REIMBURSEMENT_PER_CALL,
            allocation: std::vec![],

            statuses: std::vec![BidStatus::Pending; bids],
            filled: std::vec![0; bids],
        },
        MarketStatus::Finalized => Canonical {
            state,
            bid_count: placed,
            config_hash: true,
            rooted: true,
            finalize_by,
            reserve: MIN_FEE_RESERVE - 2 * REIMBURSEMENT_PER_CALL,
            allocation: std::vec![FILLED[0], FILLED[1], FILLED[2]],

            statuses: std::vec![BidStatus::Pending; bids],
            filled: std::vec![FILLED[0], FILLED[1], FILLED[2]],
        },
        MarketStatus::Settled => Canonical {
            state,
            bid_count: placed,
            config_hash: true,
            rooted: true,
            finalize_by,

            reserve: 0,
            allocation: std::vec![FILLED[0], FILLED[1], FILLED[2]],
            statuses: std::vec![BidStatus::Settled; bids],
            filled: std::vec![FILLED[0], FILLED[1], FILLED[2]],
        },
        MarketStatus::Cancelled => Canonical {
            state,
            bid_count: placed,
            config_hash: true,
            rooted: true,
            finalize_by,
            reserve: MIN_FEE_RESERVE - 2 * REIMBURSEMENT_PER_CALL,
            allocation: std::vec![],
            statuses: std::vec![BidStatus::Pending; bids],
            filled: std::vec![0; bids],
        },
    }
}

fn assert_canonical(
    w: &setup::World,
    config: &MarketConfig,
    expected: &Canonical,
    bidders: &Vec<Address>,
) {
    assert_eq!(market_state(w), expected.state, "get_state");
    assert_eq!(
        config_of(w),
        config.clone(),
        "get_market: the config frozen at `Open` does not change afterwards"
    );
    assert_eq!(
        config_hash_of(w).is_some(),
        expected.config_hash,
        "get_config_hash: only after `Open`"
    );
    assert_eq!(
        root_of(w).is_some(),
        expected.rooted,
        "get_commitments_root: only after `Closed`"
    );
    assert_eq!(
        finalize_by_of(w),
        expected.finalize_by,
        "get_finalize_by_ledger"
    );
    assert_eq!(fee_reserve_of(w), expected.reserve, "get_fee_reserve");
    assert_eq!(bid_count_of(w), expected.bid_count, "get_bid_count");

    let allocation: std::vec::Vec<u32> = allocation_of(w).iter().collect();
    assert_eq!(allocation, expected.allocation, "get_allocation");

    for (i, status) in expected.statuses.iter().enumerate() {
        assert_eq!(
            settlement_status_of(w, i as u32),
            *status,
            "get_settlement_status({i})"
        );
    }

    for (i, filled) in expected.filled.iter().enumerate() {
        let record = bid_record_of(w, i as u32);

        assert_eq!(
            record.filled_quantity, *filled,
            "get_bid_record({i}).filled_quantity"
        );

        assert_eq!(
            record.filled_quantity,
            expected.allocation.get(i).copied().unwrap_or(0),
            "get_allocation[{i}] and get_bid_record({i}) diverge"
        );

        assert!(has_nullifier(w, &record.nullifier), "has_nullifier({i})");
    }

    for (id, bidder) in bidders.iter().enumerate() {
        assert_eq!(
            get_participant_id(w, &bidder),
            Some(id as u32),
            "get_participant_id for bidder {id}"
        );
        assert_eq!(
            get_participant(w, id as u32),
            Some(bidder),
            "get_participant({id})"
        );
    }
    assert_eq!(
        get_participant(w, bidders.len()),
        None,
        "get_participant for an id nobody received"
    );
    assert_eq!(
        get_participant_id(w, &Address::generate(&w.e)),
        None,
        "get_participant_id for someone who never registered"
    );

    if expected.bid_count == 0 {
        assert_eq!(
            settlement_status_err(w, 0),
            AuctionError::BidNotFound,
            "get_settlement_status with no bid at all"
        );
        assert_eq!(
            bid_record_err(w, 0),
            AuctionError::BidNotFound,
            "get_bid_record with no bid at all"
        );
    }
    assert_eq!(
        settlement_status_err(w, expected.bid_count),
        AuctionError::BidNotFound,
        "get_settlement_status for an index that does not exist"
    );
    assert_eq!(
        bid_record_err(w, expected.bid_count),
        AuctionError::BidNotFound,
        "get_bid_record for an index that does not exist"
    );
}

fn get_participant_id(w: &setup::World, participant: &Address) -> Option<u32> {
    let args = vec![&w.e, participant.into_val(&w.e)];
    w.e.invoke_contract(&w.auction, &Symbol::new(&w.e, "get_participant_id"), args)
}

fn get_participant(w: &setup::World, participant_id: u32) -> Option<Address> {
    let args = vec![&w.e, participant_id.into_val(&w.e)];
    w.e.invoke_contract(&w.auction, &Symbol::new(&w.e, "get_participant"), args)
}

fn has_nullifier(w: &setup::World, nullifier: &BytesN<32>) -> bool {
    let args = vec![&w.e, nullifier.into_val(&w.e)];
    w.e.invoke_contract(&w.auction, &Symbol::new(&w.e, "has_nullifier"), args)
}

fn settlement_status_err(w: &setup::World, bid_index: u32) -> AuctionError {
    let args = vec![&w.e, bid_index.into_val(&w.e)];
    match w.e.try_invoke_contract::<BidStatus, AuctionError>(
        &w.auction,
        &Symbol::new(&w.e, "get_settlement_status"),
        args,
    ) {
        Ok(Ok(_)) => panic!("get_settlement_status({bid_index}) passed when it should have failed"),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(Ok(err)) => err,
        Err(Err(err)) => panic!("the call did not reach the contract: {err:?}"),
    }
}

fn bid_record_err(w: &setup::World, bid_index: u32) -> AuctionError {
    let args = vec![&w.e, bid_index.into_val(&w.e)];
    match w.e.try_invoke_contract::<BidRecord, AuctionError>(
        &w.auction,
        &Symbol::new(&w.e, "get_bid_record"),
        args,
    ) {
        Ok(Ok(_)) => panic!("get_bid_record({bid_index}) passed when it should have failed"),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(Ok(err)) => err,
        Err(Err(err)) => panic!("the call did not reach the contract: {err:?}"),
    }
}

pub(super) fn call_every_query(w: &setup::World, bidders: &Vec<Address>) {
    let silent = |name: &str| {
        let emitted = w.e.events().all().filter_by_contract(&w.auction);
        assert_eq!(
            emitted.events().len(),
            0,
            "the query `{name}` published an event"
        );
    };

    let _ = market_state(w);
    silent("get_state");
    let _ = config_of(w);
    silent("get_market");
    let _ = config_hash_of(w);
    silent("get_config_hash");
    let _ = root_of(w);
    silent("get_commitments_root");
    let _ = finalize_by_of(w);
    silent("get_finalize_by_ledger");
    let _ = fee_reserve_of(w);
    silent("get_fee_reserve");
    let _ = bid_count_of(w);
    silent("get_bid_count");
    let _ = allocation_of(w);
    silent("get_allocation");

    for bid_index in 0..bid_count_of(w) {
        let record = bid_record_of(w, bid_index);
        silent("get_bid_record");

        let _ = settlement_status_of(w, bid_index);
        silent("get_settlement_status");

        let _ = get_participant_id(w, &record.bidder);
        silent("get_participant_id");

        let _ = has_nullifier(w, &record.nullifier);
        silent("has_nullifier");
    }

    for (id, _) in bidders.iter().enumerate() {
        let _ = get_participant(w, id as u32);
        silent("get_participant");
    }
}

#[derive(Debug, PartialEq)]
struct Snapshot {
    storage: std::vec::Vec<(std::string::String, ScVal)>,
    ledger: u32,
}

fn snapshot(w: &setup::World) -> Snapshot {
    Snapshot {
        storage: env_storage(w),
        ledger: w.e.ledger().sequence(),
    }
}

#[test]
fn queries_do_not_mutate_state() {
    let (w, bidders, _) = a_full_auction();

    let before = snapshot(&w);
    call_every_query(&w, &bidders);
    let after = snapshot(&w);

    assert_eq!(before, after, "a query changed the state");
}

#[test]
fn every_query_returns_canonical_state() {
    let w = funded_world();
    let config = config_of(&w);
    let mut bidders = Vec::new(&w.e);

    assert_canonical(
        &w,
        &config,
        &canonical(&w, MarketStatus::Created, 0),
        &bidders,
    );

    open(&w);
    assert_canonical(&w, &config, &canonical(&w, MarketStatus::Open, 0), &bidders);

    for (i, price) in PRICES.iter().enumerate() {
        let (bidder, _) = bidder_at_price(&w, *price, REQUESTED[i], (i + 1) as u8);
        bidders.push_back(bidder);
    }
    assert_canonical(
        &w,
        &config,
        &canonical(&w, MarketStatus::Open, REQUESTED.len() as u32),
        &bidders,
    );

    at_ledger(&w, close_ledger(&w));
    close(&w, &Address::generate(&w.e));
    assert_canonical(
        &w,
        &config,
        &canonical(&w, MarketStatus::Closed, REQUESTED.len() as u32),
        &bidders,
    );

    finalize(
        &w,
        &Address::generate(&w.e),
        &quantities(&w, &FILLED),
        &a_finalize_proof(&w),
    );
    assert_canonical(
        &w,
        &config,
        &canonical(&w, MarketStatus::Finalized, REQUESTED.len() as u32),
        &bidders,
    );

    for bid_index in 0..REQUESTED.len() as u32 {
        settle(&w, &Address::generate(&w.e), bid_index);
    }
    assert_canonical(
        &w,
        &config,
        &canonical(&w, MarketStatus::Settled, REQUESTED.len() as u32),
        &bidders,
    );

    let (cancelled, bidders, _) = closed_with_prices();
    at_timeout(&cancelled);
    cancel_expired(&cancelled, &Address::generate(&cancelled.e));

    assert_canonical(
        &cancelled,
        &config_of(&cancelled),
        &canonical(&cancelled, MarketStatus::Cancelled, REQUESTED.len() as u32),
        &bidders,
    );
}

#[test]
fn no_event_contains_price_or_amount() {
    let (w, _, log) = a_full_auction();

    super::assert_no_price_leak(&w.e, &log, &secretos());
    assert_seen_every_event(&w.e, &log);
}

#[test]
fn no_storage_entry_contains_price() {
    let (w, _, _) = a_full_auction();

    let found = storage_leaks(&w.e, &env_storage(&w), &secretos());

    let mut values: std::vec::Vec<i128> = found.iter().map(|(_, value)| *value).collect();
    values.sort_unstable();
    assert_eq!(
        values,
        plantados(),
        "the scan did not find exactly the planted prices"
    );

    let expected = entry_label(&w.e, "instance", &DataKey::Bids.into_val(&w.e));
    for (label, value) in &found {
        assert_eq!(label, &expected, "the value {value} appears in {label}");
    }
}

#[test]
fn price_leak_checker_catches_a_planted_price() {
    const PLANTADO: i128 = 12_345;

    let w = setup::new_world();
    let secretos = std::vec![PLANTADO];

    let campo = as_scval(&w.e, crypto::u64_field(&w.e, PLANTADO as u64));

    for plantado in [ScVal::U64(PLANTADO as u64), campo] {
        assert_eq!(
            super::leaks_in(&w.e, &plantado, &secretos),
            secretos,
            "the scan did not catch the planted price"
        );
    }

    let vizinho = ScVal::U64(PLANTADO as u64 + 1);
    assert!(super::leaks_in(&w.e, &vizinho, &secretos).is_empty());

    let blob = as_scval(&w.e, Bytes::from_array(&w.e, &[0xAB; 32]));
    assert!(super::leaks_in(&w.e, &blob, &secretos).is_empty());

    let mut mapa: Map<Symbol, u64> = Map::new(&w.e);
    mapa.set(Symbol::new(&w.e, "ct_price"), PLANTADO as u64);
    let aninhado = as_scval(&w.e, mapa);
    assert_eq!(super::leaks_in(&w.e, &aninhado, &secretos), secretos);
}

fn assert_seen_every_event(e: &Env, log: &[ContractEvent]) {
    for name in [
        "market_opened",
        "participant_registered",
        "bid_accepted",
        "market_closed",
        "market_finalized",
        "bid_settled",
        "market_settled",
    ] {
        let wanted = as_scval(e, Symbol::new(e, name));

        let seen = log.iter().any(|event| {
            let ContractEventBody::V0(body) = &event.body;
            body.topics.first() == Some(&wanted)
        });

        assert!(
            seen,
            "the event `{name}` was not emitted in the full auction"
        );
    }
}
