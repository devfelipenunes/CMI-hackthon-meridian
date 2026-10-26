use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke};
use soroban_sdk::{vec, Address, Bytes, BytesN, IntoVal, Map, Symbol, Val, Vec};

use shared::types::{
    BidEnvelope, BidRecord, BidStatus, BidSubmission, MarketStatus, MAX_BIDS,
    SETTLEMENT_MARGIN_LEDGERS,
};

use crate::types::AuctionError;

use super::market::{config_of, escrow, funded_world, open};
use super::setup;

pub(super) fn register(w: &setup::World, participant: &Address) -> u32 {
    let args = vec![&w.e, participant.into_val(&w.e)];
    w.e.invoke_contract(&w.auction, &Symbol::new(&w.e, "register_participant"), args)
}

#[allow(clippy::type_complexity)]
fn call_register(
    w: &setup::World,
    participant: &Address,
) -> Result<u32, Result<AuctionError, soroban_sdk::InvokeError>> {
    let args = vec![&w.e, participant.into_val(&w.e)];
    match w.e.try_invoke_contract::<u32, AuctionError>(
        &w.auction,
        &Symbol::new(&w.e, "register_participant"),
        args,
    ) {
        Ok(Ok(id)) => Ok(id),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(err) => Err(err),
    }
}

pub(super) fn register_err(w: &setup::World, participant: &Address) -> AuctionError {
    match call_register(w, participant) {
        Ok(id) => panic!("register_participant passed (id {id}) when it should have failed"),
        Err(Ok(err)) => err,
        Err(Err(err)) => panic!("the call did not reach the contract: {err:?}"),
    }
}

fn participant_id_of(w: &setup::World, participant: &Address) -> Option<u32> {
    let args = vec![&w.e, participant.into_val(&w.e)];
    w.e.invoke_contract(&w.auction, &Symbol::new(&w.e, "get_participant_id"), args)
}

fn participant_addr_of(w: &setup::World, id: u32) -> Option<Address> {
    let args = vec![&w.e, id.into_val(&w.e)];
    w.e.invoke_contract(&w.auction, &Symbol::new(&w.e, "get_participant"), args)
}

fn open_world() -> setup::World {
    let w = funded_world();
    open(&w);
    w
}

fn set_state(w: &setup::World, state: MarketStatus) {
    w.e.as_contract(&w.auction, || {
        w.e.storage()
            .instance()
            .set(&crate::types::DataKey::State, &state);
    });
}

#[test]
fn first_participant_gets_id_0_then_1() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    let bruno = Address::generate(&w.e);

    assert_eq!(register(&w, &ana), 0);
    assert_eq!(register(&w, &bruno), 1);
}

#[test]
fn mapping_is_bidirectional() {
    let w = open_world();
    let ana = Address::generate(&w.e);

    let id = register(&w, &ana);

    assert_eq!(participant_id_of(&w, &ana), Some(id));
    assert_eq!(participant_addr_of(&w, id), Some(ana));

    let estranho = Address::generate(&w.e);
    assert_eq!(participant_id_of(&w, &estranho), None);
    assert_eq!(participant_addr_of(&w, 7), None);
}

#[test]
fn duplicate_registration_fails() {
    let w = open_world();
    let ana = Address::generate(&w.e);

    let first = register(&w, &ana);

    assert_eq!(register_err(&w, &ana), AuctionError::AlreadyRegistered);
    assert_eq!(
        participant_id_of(&w, &ana),
        Some(first),
        "the id changed after the refusal"
    );
}

#[test]
fn register_requires_auth() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    let impostor = Address::generate(&w.e);

    w.e.mock_auths(&[MockAuth {
        address: &impostor,
        invoke: &MockAuthInvoke {
            contract: &w.auction,
            fn_name: "register_participant",
            args: vec![&w.e, ana.into_val(&w.e)],
            sub_invokes: &[],
        },
    }]);

    assert!(
        call_register(&w, &ana).is_err(),
        "an impostor does not register a participant on their behalf"
    );
    assert_eq!(participant_id_of(&w, &ana), None);
}

#[test]
fn register_only_when_open() {
    let w = funded_world();
    let ana = Address::generate(&w.e);

    for state in [MarketStatus::Created, MarketStatus::Closed] {
        set_state(&w, state);

        assert_eq!(
            register_err(&w, &ana),
            AuctionError::InvalidState,
            "registered with the market in {state:?}"
        );
        assert_eq!(participant_id_of(&w, &ana), None);
    }
}

#[test]
fn no_policy_accepts_anyone() {
    let w = open_world();
    let qualquer = Address::generate(&w.e);

    assert_eq!(config_of(&w).params.eligibility_policy, None);
    assert_eq!(register(&w, &qualquer), 0);
}

#[test]
fn policy_deny_blocks_registration() {
    let w = setup::new_world_with_policy();
    w.fund(&w.seller, escrow(&w) * 3);
    open(&w);

    assert!(config_of(&w).params.eligibility_policy.is_some());
    let recusado = Address::generate(&w.e);

    assert_eq!(register_err(&w, &recusado), AuctionError::NotEligible);
    assert_eq!(
        participant_id_of(&w, &recusado),
        None,
        "the refusal consumed an id"
    );
}

#[test]
fn participant_registered_event() {
    let w = open_world();
    let ana = Address::generate(&w.e);

    let id = register(&w, &ana);

    let emitted = w.e.events().all().filter_by_contract(&w.auction);

    let mut data: Map<Symbol, Val> = Map::new(&w.e);
    data.set(Symbol::new(&w.e, "participant_id"), id.into_val(&w.e));

    let expected = vec![
        &w.e,
        (
            w.auction.clone(),
            vec![
                &w.e,
                Symbol::new(&w.e, "participant_registered").into_val(&w.e),
                ana.into_val(&w.e),
            ],
            data.into_val(&w.e),
        ),
    ];

    assert_eq!(emitted, expected);
}

pub(super) fn a_bid(w: &setup::World, requested_quantity: u32, seed: u8) -> BidSubmission {
    BidSubmission {
        requested_quantity,
        commitment: BytesN::from_array(&w.e, &[seed; 32]),
        nullifier: BytesN::from_array(&w.e, &[seed.wrapping_add(100); 32]),
        envelope: BidEnvelope {
            r_point: BytesN::from_array(&w.e, &[seed; 64]),
            ct_price: BytesN::from_array(&w.e, &[seed; 32]),
            ct_blinding: BytesN::from_array(&w.e, &[seed; 32]),
            ct_seed: BytesN::from_array(&w.e, &[seed; 32]),
        },
        proof: Bytes::from_array(&w.e, &[seed; 8]),
    }
}

pub(super) fn submit(w: &setup::World, bidder: &Address, bid: &BidSubmission) -> u32 {
    let args = vec![&w.e, bidder.into_val(&w.e), bid.into_val(&w.e)];
    w.e.invoke_contract(&w.auction, &Symbol::new(&w.e, "submit_bid"), args)
}

#[allow(clippy::type_complexity)]
fn call_submit(
    w: &setup::World,
    bidder: &Address,
    bid: &BidSubmission,
) -> Result<u32, Result<AuctionError, soroban_sdk::InvokeError>> {
    let args = vec![&w.e, bidder.into_val(&w.e), bid.into_val(&w.e)];
    match w.e.try_invoke_contract::<u32, AuctionError>(
        &w.auction,
        &Symbol::new(&w.e, "submit_bid"),
        args,
    ) {
        Ok(Ok(index)) => Ok(index),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(err) => Err(err),
    }
}

pub(super) fn submit_err(w: &setup::World, bidder: &Address, bid: &BidSubmission) -> AuctionError {
    match call_submit(w, bidder, bid) {
        Ok(index) => panic!("submit_bid passed (index {index}) when it should have failed"),
        Err(Ok(err)) => err,
        Err(Err(err)) => panic!("the call did not reach the contract: {err:?}"),
    }
}

fn bid_count(w: &setup::World) -> u32 {
    super::invoke::<u32>(&w.e, &w.auction, "get_bid_count")
}

fn bid_record(w: &setup::World, bid_index: u32) -> BidRecord {
    let args = vec![&w.e, bid_index.into_val(&w.e)];
    w.e.invoke_contract(&w.auction, &Symbol::new(&w.e, "get_bid_record"), args)
}

fn has_nullifier(w: &setup::World, nullifier: &BytesN<32>) -> bool {
    let args = vec![&w.e, nullifier.into_val(&w.e)];
    w.e.invoke_contract(&w.auction, &Symbol::new(&w.e, "has_nullifier"), args)
}

fn register_n(w: &setup::World, n: u32) -> Vec<Address> {
    let mut bidders = Vec::new(&w.e);
    for _ in 0..n {
        let bidder = Address::generate(&w.e);
        register(w, &bidder);
        bidders.push_back(bidder);
    }
    bidders
}

#[test]
fn valid_bid_is_accepted_with_index_0() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    register(&w, &ana);

    assert_eq!(submit(&w, &ana, &a_bid(&w, 3, 1)), 0);
    assert_eq!(bid_count(&w), 1);
}

#[test]
fn bid_record_has_no_price() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    let id = register(&w, &ana);
    let bid = a_bid(&w, 3, 1);

    submit(&w, &ana, &bid);

    assert_eq!(
        bid_record(&w, 0),
        BidRecord {
            bidder: ana.clone(),
            participant_id: id,
            commitment: bid.commitment.clone(),
            nullifier: bid.nullifier.clone(),
            requested_quantity: bid.requested_quantity,
            envelope: bid.envelope.clone(),
            filled_quantity: 0,
            status: BidStatus::Pending,
        }
    );
}

#[test]
fn envelope_is_stored() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    register(&w, &ana);
    let bid = a_bid(&w, 3, 7);

    submit(&w, &ana, &bid);

    assert_eq!(bid_record(&w, 0).envelope, bid.envelope);
}

#[test]
fn bid_when_not_open_fails() {
    let w = funded_world();
    let ana = Address::generate(&w.e);
    let bid = a_bid(&w, 3, 1);

    for state in [MarketStatus::Created, MarketStatus::Closed] {
        set_state(&w, state);

        assert_eq!(
            submit_err(&w, &ana, &bid),
            AuctionError::InvalidState,
            "accepted a bid with the market in {state:?}"
        );
        assert_eq!(bid_count(&w), 0);
    }
}

#[test]
fn bid_at_close_ledger_fails() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    register(&w, &ana);

    let close = config_of(&w).params.close_ledger;
    w.e.ledger().with_mut(|li| li.sequence_number = close);

    assert_eq!(
        submit_err(&w, &ana, &a_bid(&w, 3, 1)),
        AuctionError::BiddingClosed
    );
    assert_eq!(bid_count(&w), 0);
}

#[test]
fn bid_without_auth_fails() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    register(&w, &ana);
    let impostor = Address::generate(&w.e);

    w.e.mock_auths(&[MockAuth {
        address: &impostor,
        invoke: &MockAuthInvoke {
            contract: &w.auction,
            fn_name: "submit_bid",
            args: vec![&w.e, ana.into_val(&w.e), a_bid(&w, 3, 1).into_val(&w.e)],
            sub_invokes: &[],
        },
    }]);

    assert!(
        call_submit(&w, &ana, &a_bid(&w, 3, 1)).is_err(),
        "an impostor placed a bid on behalf of the bidder"
    );
    assert_eq!(bid_count(&w), 0);
}

#[test]
fn ninth_bid_fails_market_full() {
    let w = open_world();
    let bidders = register_n(&w, MAX_BIDS + 1);

    for i in 0..MAX_BIDS {
        let bidder = bidders.get(i).unwrap();
        assert_eq!(submit(&w, &bidder, &a_bid(&w, 1, i as u8)), i);
    }

    let nono = bidders.get(MAX_BIDS).unwrap();
    assert_eq!(
        submit_err(&w, &nono, &a_bid(&w, 1, 99)),
        AuctionError::MarketFull
    );
    assert_eq!(bid_count(&w), MAX_BIDS);
}

#[test]
fn unregistered_bidder_fails() {
    let w = open_world();
    let estranho = Address::generate(&w.e);

    assert_eq!(
        submit_err(&w, &estranho, &a_bid(&w, 1, 1)),
        AuctionError::NotRegistered
    );
    assert_eq!(bid_count(&w), 0);
}

#[test]
fn second_bid_same_participant_fails() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    register(&w, &ana);

    assert_eq!(submit(&w, &ana, &a_bid(&w, 1, 1)), 0);

    assert_eq!(
        submit_err(&w, &ana, &a_bid(&w, 2, 2)),
        AuctionError::AlreadyBid
    );
    assert_eq!(bid_count(&w), 1);
}

#[test]
fn zero_quantity_fails() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    register(&w, &ana);

    assert_eq!(
        submit_err(&w, &ana, &a_bid(&w, 0, 1)),
        AuctionError::ZeroQuantity
    );
    assert_eq!(bid_count(&w), 0);
}

#[test]
fn reused_nullifier_fails() {
    let w = open_world();
    let bidders = register_n(&w, 2);
    let ana = bidders.get(0).unwrap();
    let bruno = bidders.get(1).unwrap();

    let mut first = a_bid(&w, 1, 1);
    submit(&w, &ana, &first);
    assert!(has_nullifier(&w, &first.nullifier));

    let mut second = a_bid(&w, 1, 2);
    second.nullifier = first.nullifier.clone();
    assert_eq!(submit_err(&w, &bruno, &second), AuctionError::NullifierUsed);
    assert_eq!(bid_count(&w), 1);

    first.nullifier = BytesN::from_array(&w.e, &[9; 32]);
    assert!(!has_nullifier(&w, &first.nullifier));
}

#[test]
fn policy_revoked_after_registration_blocks_bid() {
    let w = setup::new_world_with_policy();
    w.fund(&w.seller, escrow(&w) * 3);
    open(&w);

    let policy = config_of(&w)
        .params
        .eligibility_policy
        .expect("the world should have a policy");

    w.e.invoke_contract::<()>(
        &policy,
        &Symbol::new(&w.e, "set_allow"),
        vec![&w.e, true.into_val(&w.e)],
    );
    let ana = Address::generate(&w.e);
    register(&w, &ana);

    w.e.invoke_contract::<()>(
        &policy,
        &Symbol::new(&w.e, "set_allow"),
        vec![&w.e, false.into_val(&w.e)],
    );

    assert_eq!(
        submit_err(&w, &ana, &a_bid(&w, 1, 1)),
        AuctionError::NotEligible
    );
    assert_eq!(bid_count(&w), 0);
}

#[test]
fn check_order_is_cheap_first() {
    let w = open_world();
    let estranho = Address::generate(&w.e);

    let close = config_of(&w).params.close_ledger;
    w.e.ledger().with_mut(|li| li.sequence_number = close);
    assert_eq!(
        submit_err(&w, &estranho, &a_bid(&w, 0, 1)),
        AuctionError::BiddingClosed,
        "the state check should come before the others"
    );

    w.e.ledger().with_mut(|li| li.sequence_number = close - 1);
    assert_eq!(
        submit_err(&w, &estranho, &a_bid(&w, 0, 1)),
        AuctionError::NotRegistered,
        "registration should be checked before the quantity"
    );
}

#[test]
fn failed_bid_changes_nothing() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    register(&w, &ana);
    let bid = a_bid(&w, 0, 1);

    let count_before = bid_count(&w);

    assert_eq!(submit_err(&w, &ana, &bid), AuctionError::ZeroQuantity);

    assert_eq!(bid_count(&w), count_before, "the counter moved");
    assert!(
        !has_nullifier(&w, &bid.nullifier),
        "the nullifier was consumed by a rejected bid"
    );
    assert!(
        call_get_bid_record(&w, 0).is_err(),
        "a record of a rejected bid was left behind"
    );
}

fn call_get_bid_record(
    w: &setup::World,
    bid_index: u32,
) -> Result<BidRecord, Result<AuctionError, soroban_sdk::InvokeError>> {
    let args = vec![&w.e, bid_index.into_val(&w.e)];
    match w.e.try_invoke_contract::<BidRecord, AuctionError>(
        &w.auction,
        &Symbol::new(&w.e, "get_bid_record"),
        args,
    ) {
        Ok(Ok(record)) => Ok(record),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(err) => Err(err),
    }
}

fn set_verifier_accept(w: &setup::World, accept: bool) {
    let verifier = config_of(w).platform.bid_verifier;
    let args = vec![&w.e, accept.into_val(&w.e)];
    w.e.invoke_contract::<()>(&verifier, &Symbol::new(&w.e, "set_accept"), args);
}

fn verifier_inputs(w: &setup::World) -> Bytes {
    let verifier = config_of(w).platform.bid_verifier;
    w.e.invoke_contract(&verifier, &Symbol::new(&w.e, "last_inputs"), vec![&w.e])
}

fn verifier_proof(w: &setup::World) -> Bytes {
    let verifier = config_of(w).platform.bid_verifier;
    w.e.invoke_contract(&verifier, &Symbol::new(&w.e, "last_proof"), vec![&w.e])
}

fn set_delegation(w: &setup::World, account: &Address, allowance_commitment: &BytesN<64>) {
    let token = config_of(w).platform.collateral_token;
    let args = vec![
        &w.e,
        account.into_val(&w.e),
        w.auction.into_val(&w.e),
        allowance_commitment.into_val(&w.e),
    ];
    w.e.invoke_contract::<()>(&token, &Symbol::new(&w.e, "set_delegation"), args);
}

fn config_hash_of(w: &setup::World) -> BytesN<32> {
    super::invoke::<Option<BytesN<32>>>(&w.e, &w.auction, "get_config_hash")
        .expect("the market should be open")
}

pub(super) fn u32_field(w: &setup::World, v: u32) -> Bytes {
    let mut out = [0u8; 32];
    out[28..32].copy_from_slice(&v.to_be_bytes());
    Bytes::from_array(&w.e, &out)
}

pub(super) fn u64_field(w: &setup::World, v: u64) -> Bytes {
    let mut out = [0u8; 32];
    out[24..32].copy_from_slice(&v.to_be_bytes());
    Bytes::from_array(&w.e, &out)
}

fn expected_public_inputs(
    w: &setup::World,
    id: u32,
    bid: &BidSubmission,
    c_a: &BytesN<64>,
) -> Bytes {
    let config = config_of(w);
    let hash = config_hash_of(w).to_array();

    let mut lo = [0u8; 32];
    lo[16..32].copy_from_slice(&hash[16..32]);
    let mut hi = [0u8; 32];
    hi[16..32].copy_from_slice(&hash[0..16]);

    let mut out = Bytes::new(&w.e);
    out.append(&Bytes::from_array(&w.e, &bid.commitment.to_array()));
    out.append(&Bytes::from_array(&w.e, &bid.nullifier.to_array()));
    out.append(&u64_field(w, config.market_id));
    out.append(&u32_field(w, id));
    out.append(&u32_field(w, bid.requested_quantity));
    out.append(&u64_field(w, config.params.min_price_per_quota));
    out.append(&Bytes::from_array(&w.e, &c_a.to_array()));
    out.append(&Bytes::from_array(&w.e, &bid.envelope.r_point.to_array()));
    out.append(&Bytes::from_array(&w.e, &bid.envelope.ct_price.to_array()));
    out.append(&Bytes::from_array(
        &w.e,
        &bid.envelope.ct_blinding.to_array(),
    ));
    out.append(&Bytes::from_array(&w.e, &bid.envelope.ct_seed.to_array()));
    out.append(&Bytes::from_array(&w.e, &lo));
    out.append(&Bytes::from_array(&w.e, &hi));
    out
}

#[test]
fn public_inputs_match_circuit_order() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    let id = register(&w, &ana);
    let bid = a_bid(&w, 3, 1);
    let c_a = BytesN::from_array(&w.e, &[0xAB; 64]);
    set_delegation(&w, &ana, &c_a);

    submit(&w, &ana, &bid);
    let sent = verifier_inputs(&w);

    assert_eq!(sent.len(), 480, "15 fields of 32 bytes");
    assert_eq!(sent, expected_public_inputs(&w, id, &bid, &c_a));

    assert_eq!(&sent.slice(64..96), &u64_field(&w, config_of(&w).market_id));
    assert_eq!(&sent.slice(96..128), &u32_field(&w, id));
    assert_eq!(&sent.slice(128..160), &u32_field(&w, 3));
    assert_eq!(
        &sent.slice(192..256),
        &Bytes::from_array(&w.e, &c_a.to_array())
    );

    assert_eq!(verifier_proof(&w), bid.proof);
}

#[test]
fn participant_id_comes_from_state_not_caller() {
    let w = open_world();
    let bruno = Address::generate(&w.e);
    let ana = Address::generate(&w.e);
    register(&w, &bruno);
    let ana_id = register(&w, &ana);

    submit(&w, &ana, &a_bid(&w, 1, 1));

    let sent = verifier_inputs(&w);
    assert_eq!(
        &sent.slice(96..128),
        &u32_field(&w, ana_id),
        "the id in the input is not the one from state"
    );
}

#[test]
fn config_hash_comes_from_storage() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    let id = register(&w, &ana);
    let bid = a_bid(&w, 1, 1);

    submit(&w, &ana, &bid);

    let expected = expected_public_inputs(&w, id, &bid, &BytesN::from_array(&w.e, &[0; 64]));
    let sent = verifier_inputs(&w);
    assert_eq!(&sent.slice(416..448), &expected.slice(416..448), "lo");
    assert_eq!(&sent.slice(448..480), &expected.slice(448..480), "hi");
}

#[test]
fn c_a_comes_from_token() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    let id = register(&w, &ana);
    let bid = a_bid(&w, 1, 1);
    let c_a = BytesN::from_array(&w.e, &[0x5A; 64]);
    set_delegation(&w, &ana, &c_a);

    submit(&w, &ana, &bid);

    let sent = verifier_inputs(&w);
    assert_eq!(
        &sent.slice(192..256),
        &Bytes::from_array(&w.e, &c_a.to_array()),
        "inputs 6-7 are not the token's C_a"
    );
    assert_eq!(sent, expected_public_inputs(&w, id, &bid, &c_a));
}

#[test]
fn verifier_reject_maps_to_invalid_bid_proof() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    register(&w, &ana);
    set_verifier_accept(&w, false);

    assert_eq!(
        submit_err(&w, &ana, &a_bid(&w, 1, 1)),
        AuctionError::InvalidBidProof
    );
}

#[test]
fn rejected_proof_does_not_consume_nullifier() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    register(&w, &ana);
    let bid = a_bid(&w, 1, 1);
    set_verifier_accept(&w, false);

    assert_eq!(submit_err(&w, &ana, &bid), AuctionError::InvalidBidProof);

    assert!(
        !has_nullifier(&w, &bid.nullifier),
        "the nullifier was burned"
    );
    assert_eq!(
        bid_count(&w),
        0,
        "a bid from a rejected proof was left behind"
    );
}

#[test]
fn rejected_bid_can_be_resubmitted() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    register(&w, &ana);

    set_verifier_accept(&w, false);
    assert_eq!(
        submit_err(&w, &ana, &a_bid(&w, 1, 1)),
        AuctionError::InvalidBidProof
    );

    set_verifier_accept(&w, true);
    assert_eq!(submit(&w, &ana, &a_bid(&w, 1, 1)), 0);
    assert_eq!(bid_count(&w), 1);
}

#[test]
fn bid_accepted_event_has_quantity_not_price() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    register(&w, &ana);

    let index = submit(&w, &ana, &a_bid(&w, 3, 1));

    let emitted = w.e.events().all().filter_by_contract(&w.auction);

    let mut data: Map<Symbol, Val> = Map::new(&w.e);
    data.set(Symbol::new(&w.e, "bid_index"), index.into_val(&w.e));
    data.set(Symbol::new(&w.e, "requested_quantity"), 3u32.into_val(&w.e));

    let expected = vec![
        &w.e,
        (
            w.auction.clone(),
            vec![
                &w.e,
                Symbol::new(&w.e, "bid_accepted").into_val(&w.e),
                ana.into_val(&w.e),
            ],
            data.into_val(&w.e),
        ),
    ];

    assert_eq!(emitted, expected);
}

const ACCOUNT_WITHOUT_TRUSTLINE: &str = "GDWDVMLRUGURYHMRMGICBFVZFAIDFG7LWOFVBK6P4CVWTR33VIZUMS77";

fn required_live_until(w: &setup::World) -> u32 {
    let config = config_of(w);
    config.params.close_ledger + config.finalization_grace_ledgers + SETTLEMENT_MARGIN_LEDGERS
}

fn revoke_delegation(w: &setup::World, account: &Address) {
    let token = config_of(w).platform.collateral_token;
    let args = vec![&w.e, account.into_val(&w.e), w.auction.into_val(&w.e)];
    w.e.invoke_contract::<()>(&token, &Symbol::new(&w.e, "revoke_delegation"), args);
}

fn set_delegation_expiry(w: &setup::World, account: &Address, live_until_ledger: u32) {
    let token = config_of(w).platform.collateral_token;
    let args = vec![
        &w.e,
        account.into_val(&w.e),
        w.auction.into_val(&w.e),
        live_until_ledger.into_val(&w.e),
    ];
    w.e.invoke_contract::<()>(&token, &Symbol::new(&w.e, "set_delegation_expiry"), args);
}

fn is_spender(w: &setup::World, account: &Address) -> bool {
    let token = config_of(w).platform.collateral_token;
    let args = vec![&w.e, account.into_val(&w.e), w.auction.into_val(&w.e)];
    w.e.invoke_contract(&token, &Symbol::new(&w.e, "is_spender"), args)
}

#[test]
fn bidder_without_trustline_fails_no_trustline() {
    let w = open_world();
    let ana = Address::from_str(&w.e, ACCOUNT_WITHOUT_TRUSTLINE);
    register(&w, &ana);

    assert_eq!(
        submit_err(&w, &ana, &a_bid(&w, 3, 1)),
        AuctionError::NoTrustline
    );
    assert_eq!(bid_count(&w), 0);
}

#[test]
fn bidder_without_delegation_fails_no_collateral() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    register(&w, &ana);
    revoke_delegation(&w, &ana);

    assert_eq!(
        submit_err(&w, &ana, &a_bid(&w, 3, 1)),
        AuctionError::NoCollateral
    );
    assert_eq!(bid_count(&w), 0);
}

#[test]
fn revoked_delegation_fails_no_collateral() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    register(&w, &ana);
    set_delegation(&w, &ana, &BytesN::from_array(&w.e, &[0xAB; 64]));
    assert!(
        is_spender(&w, &ana),
        "the delegation should be live before the revocation"
    );

    revoke_delegation(&w, &ana);

    assert_eq!(
        submit_err(&w, &ana, &a_bid(&w, 3, 1)),
        AuctionError::NoCollateral
    );
}

#[test]
fn live_until_below_required_fails_collateral_expires_too_soon() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    register(&w, &ana);
    set_delegation_expiry(&w, &ana, required_live_until(&w) - 1);

    assert!(
        is_spender(&w, &ana),
        "the delegation should be live: it is the Auction's comparison that rejects"
    );

    assert_eq!(
        submit_err(&w, &ana, &a_bid(&w, 3, 1)),
        AuctionError::CollateralExpiresTooSoon
    );
}

#[test]
fn live_until_exactly_required_is_accepted() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    register(&w, &ana);
    set_delegation_expiry(&w, &ana, required_live_until(&w));

    assert_eq!(submit(&w, &ana, &a_bid(&w, 3, 1)), 0);
}

#[test]
fn live_until_in_past_is_rejected() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    register(&w, &ana);

    set_delegation_expiry(&w, &ana, w.e.ledger().sequence() - 1);
    assert!(
        !is_spender(&w, &ana),
        "the token considers a delegation with a past expiry to be expired"
    );

    assert_eq!(
        submit_err(&w, &ana, &a_bid(&w, 3, 1)),
        AuctionError::NoCollateral
    );
}

#[test]
fn failed_collateral_check_changes_nothing() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    register(&w, &ana);
    revoke_delegation(&w, &ana);
    let bid = a_bid(&w, 3, 1);

    assert_eq!(submit_err(&w, &ana, &bid), AuctionError::NoCollateral);

    assert_eq!(bid_count(&w), 0, "the counter moved");
    assert!(
        !has_nullifier(&w, &bid.nullifier),
        "the nullifier was consumed by a rejected bid"
    );
    assert!(
        call_get_bid_record(&w, 0).is_err(),
        "a record of a rejected bid was left behind"
    );
}

#[test]
fn collateral_reference_is_the_bidder_address() {
    let w = open_world();
    let ana = Address::generate(&w.e);
    let bruno = Address::generate(&w.e);
    register(&w, &ana);
    register(&w, &bruno);
    let ana_c_a = BytesN::from_array(&w.e, &[0xAA; 64]);
    let bruno_c_a = BytesN::from_array(&w.e, &[0xBB; 64]);
    set_delegation(&w, &ana, &ana_c_a);
    set_delegation(&w, &bruno, &bruno_c_a);

    submit(&w, &ana, &a_bid(&w, 3, 1));
    assert_eq!(
        &verifier_inputs(&w).slice(192..256),
        &Bytes::from_array(&w.e, &ana_c_a.to_array()),
        "Ana's C_a did not reach the public inputs"
    );

    submit(&w, &bruno, &a_bid(&w, 2, 2));
    assert_eq!(
        &verifier_inputs(&w).slice(192..256),
        &Bytes::from_array(&w.e, &bruno_c_a.to_array()),
        "Bruno's C_a did not reach the public inputs"
    );

    assert_eq!(bid_record(&w, 0).bidder, ana);
    assert_eq!(bid_record(&w, 1).bidder, bruno);
}
