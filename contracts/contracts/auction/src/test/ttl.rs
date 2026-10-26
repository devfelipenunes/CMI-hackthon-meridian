use shared::types::{SETTLEMENT_MARGIN_LEDGERS, TTL_BUFFER_LEDGERS};

use crate::types::DataKey;
use soroban_sdk::testutils::storage::{Instance as _, Persistent as _};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::Address;

use super::bidding::{a_bid, register, submit};
use super::market::{
    a_finalize_proof, at_ledger, bid_count_of, bid_record_of, cancel, cancelled_with_bidders,
    close, close_ledger, config_of, finalize, finalized_with, funded_world, open, quantities,
};
use super::queries::call_every_query;
use super::settlement::{release, revoke_delegation, settle};
use super::setup;

fn required_ledger(w: &setup::World) -> u32 {
    let config = config_of(w);

    config.params.close_ledger
        + config.finalization_grace_ledgers
        + SETTLEMENT_MARGIN_LEDGERS
        + TTL_BUFFER_LEDGERS
}

fn instance_live_until(w: &setup::World) -> u32 {
    let ttl =
        w.e.as_contract(&w.auction, || w.e.storage().instance().get_ttl());
    w.e.ledger().sequence() + ttl
}

fn persistent_live_until(w: &setup::World, key: &DataKey) -> u32 {
    let ttl =
        w.e.as_contract(&w.auction, || w.e.storage().persistent().get_ttl(key));
    w.e.ledger().sequence() + ttl
}

fn assert_reaches_required(w: &setup::World, label: &str, entry: &str, live_until: u32) {
    let required = required_ledger(w);

    assert!(
        live_until >= required,
        "`{entry}` expires at ledger {live_until}, before the last possible ledger \
         ({required}) - after {label}"
    );
}

fn assert_instance_covered(w: &setup::World, label: &str) {
    assert_reaches_required(w, label, "instance", instance_live_until(w));
}

fn assert_key_covered(w: &setup::World, label: &str, nome: &str, key: &DataKey) {
    assert_reaches_required(w, label, nome, persistent_live_until(w, key));
}

fn bid_entries(w: &setup::World) -> std::vec::Vec<(std::string::String, DataKey)> {
    let mut entries = std::vec::Vec::new();

    for i in 0..bid_count_of(w) {
        let record = bid_record_of(w, i);
        entries.push((
            std::format!("ParticipantId of bid {i}"),
            DataKey::ParticipantId(record.bidder),
        ));
        entries.push((
            std::format!("ParticipantAddr of bid {i}"),
            DataKey::ParticipantAddr(record.participant_id),
        ));
        entries.push((
            std::format!("Nullifier of bid {i}"),
            DataKey::Nullifier(record.nullifier),
        ));
    }

    entries
}

fn assert_everything_covered(w: &setup::World, label: &str) {
    assert_instance_covered(w, label);

    for (nome, key) in bid_entries(w) {
        assert_key_covered(w, label, &nome, &key);
    }
}

#[test]
fn every_write_extends_ttl_to_required_ledger() {
    let w = funded_world();
    assert_instance_covered(&w, "the constructor");

    open(&w);
    assert_instance_covered(&w, "open_market");

    let bidder = Address::generate(&w.e);
    let participant_id = register(&w, &bidder);
    assert_instance_covered(&w, "register_participant");
    assert_key_covered(
        &w,
        "register_participant",
        "ParticipantId",
        &DataKey::ParticipantId(bidder.clone()),
    );
    assert_key_covered(
        &w,
        "register_participant",
        "ParticipantAddr",
        &DataKey::ParticipantAddr(participant_id),
    );

    let bid = a_bid(&w, 2, 1);
    submit(&w, &bidder, &bid);
    assert_everything_covered(&w, "submit_bid");

    at_ledger(&w, close_ledger(&w));
    close(&w, &Address::generate(&w.e));
    assert_everything_covered(&w, "close_market");

    let filled = quantities(&w, &[2]);
    finalize(&w, &Address::generate(&w.e), &filled, &a_finalize_proof(&w));
    assert_everything_covered(&w, "finalize");

    settle(&w, &Address::generate(&w.e), 0);
    assert_everything_covered(&w, "settle");

    let (w, _) = finalized_with(&[2], &[2]);
    let record = bid_record_of(&w, 0);
    revoke_delegation(&w, &record.bidder);
    release(&w, &Address::generate(&w.e), 0);
    assert_everything_covered(&w, "release_unsettled");

    let w = funded_world();
    cancel(&w);
    assert_instance_covered(&w, "cancel_market");

    let (w, _) = cancelled_with_bidders(&[2]);
    assert_everything_covered(&w, "cancel_expired");
}

#[test]
fn entries_alive_at_last_possible_settlement() {
    let (w, bidders) = finalized_with(&[2, 2], &[2, 0]);
    let last = required_ledger(&w) - TTL_BUFFER_LEDGERS - 1;

    at_ledger(&w, last);
    assert_everything_covered(&w, "reaching the last ledger");

    call_every_query(&w, &bidders);

    for bid_index in 0..bid_count_of(&w) {
        settle(&w, &Address::generate(&w.e), bid_index);
        assert_everything_covered(&w, "settle at the last ledger");
    }
}

#[test]
fn late_write_still_extends_instance_by_the_buffer() {
    let (w, bidders) = finalized_with(&[2, 2], &[2, 0]);
    let late = required_ledger(&w) + 100;

    revoke_delegation(&w, &bidders.get(0).unwrap());
    at_ledger(&w, late);
    release(&w, &Address::generate(&w.e), 0);

    let live_until = instance_live_until(&w);
    assert!(
        live_until >= late + TTL_BUFFER_LEDGERS,
        "the write at ledger {late} left the instance alive only until {live_until}, less than the \
         {TTL_BUFFER_LEDGERS}-ledger buffer from D-05"
    );
}

#[test]
fn participant_and_nullifier_entries_extended() {
    let w = funded_world();
    open(&w);

    let bidder = Address::generate(&w.e);
    let participant_id = register(&w, &bidder);

    let id_key = DataKey::ParticipantId(bidder.clone());
    let addr_key = DataKey::ParticipantAddr(participant_id);
    assert_key_covered(&w, "register_participant", "ParticipantId", &id_key);
    assert_key_covered(&w, "register_participant", "ParticipantAddr", &addr_key);

    let bid = a_bid(&w, 1, 1);
    submit(&w, &bidder, &bid);
    let nullifier_key = DataKey::Nullifier(bid.nullifier.clone());
    assert_key_covered(&w, "submit_bid", "Nullifier", &nullifier_key);

    at_ledger(&w, close_ledger(&w));
    close(&w, &Address::generate(&w.e));

    assert_key_covered(&w, "close_market", "ParticipantId", &id_key);
    assert_key_covered(&w, "close_market", "ParticipantAddr", &addr_key);
    assert_key_covered(&w, "close_market", "Nullifier", &nullifier_key);
}
