use shared::types::{
    BidStatus, SettleOutcome, MIN_FEE_RESERVE, QUOTA_UNIT, REIMBURSEMENT_PER_CALL,
};
use soroban_sdk::testutils::{Address as _, Events as _, MockAuth, MockAuthInvoke};
use soroban_sdk::xdr::{FromXdr, ToXdr};
use soroban_sdk::{vec, Address, Bytes, BytesN, IntoVal, Map, Symbol, Val, Vec};

use crate::external::{SpenderTransferData, SpenderTransferPayload};
use crate::types::{AuctionError, MarketStatus};

use super::bidding::u32_field;
use super::fakes::TransferCall;
use super::market::{
    bid_record_of, cancelled_with_bidders, closed_with_bidders, config_of, fee_balance,
    fee_reserve_of, finalized_with, market_state, open_bids_of, quota_balance,
};
use super::setup;

const SELLER: (u8, u8) = (0xA1, 0xA2);
const FEE: (u8, u8) = (0xB1, 0xB2);
const REFUND: (u8, u8) = (0xC1, 0xC2);

fn point(w: &setup::World, xy: (u8, u8)) -> BytesN<64> {
    let mut raw = [0u8; 64];
    raw[..32].copy_from_slice(&[xy.0; 32]);
    raw[32..].copy_from_slice(&[xy.1; 32]);
    BytesN::from_array(&w.e, &raw)
}

fn transfer_data(w: &setup::World, c_tx: &BytesN<64>) -> Bytes {
    SpenderTransferData {
        payload: SpenderTransferPayload {
            c_a_new: BytesN::from_array(&w.e, &[0; 64]),
            c_tx: c_tx.clone(),
            r_e: BytesN::from_array(&w.e, &[0; 64]),
            v_tilde: BytesN::from_array(&w.e, &[0; 32]),
            a_tilde_new: BytesN::from_array(&w.e, &[0; 32]),
            sigma_a_new: BytesN::from_array(&w.e, &[0; 32]),
            v_aud_r: BytesN::from_array(&w.e, &[0; 32]),
            r_aud_r: BytesN::from_array(&w.e, &[0; 32]),
            v_aud_s: BytesN::from_array(&w.e, &[0; 32]),
            a_aud_s: BytesN::from_array(&w.e, &[0; 32]),
        },
        proof: Bytes::new(&w.e),
    }
    .to_xdr(&w.e)
}

fn legs(w: &setup::World) -> (Bytes, Bytes, Bytes) {
    (
        transfer_data(w, &point(w, SELLER)),
        transfer_data(w, &point(w, FEE)),
        transfer_data(w, &point(w, REFUND)),
    )
}

fn decoded_c_tx(w: &setup::World, call: &TransferCall) -> BytesN<64> {
    SpenderTransferData::from_xdr(&w.e, &call.data)
        .expect("the data forwarded to the token does not decode")
        .payload
        .c_tx
}

pub(super) fn settlement_status_of(w: &setup::World, bid_index: u32) -> BidStatus {
    let args = vec![&w.e, bid_index.into_val(&w.e)];
    w.e.invoke_contract(
        &w.auction,
        &Symbol::new(&w.e, "get_settlement_status"),
        args,
    )
}

fn transfers(w: &setup::World) -> Vec<TransferCall> {
    let token = config_of(w).platform.collateral_token;
    w.e.invoke_contract(&token, &Symbol::new(&w.e, "transfers"), vec![&w.e])
}

fn set_fail_at(w: &setup::World, at: Option<u32>) {
    let token = config_of(w).platform.collateral_token;
    let args = vec![&w.e, at.into_val(&w.e)];
    w.e.invoke_contract::<()>(&token, &Symbol::new(&w.e, "set_fail_at"), args);
}

fn settlement_inputs_of(w: &setup::World) -> Bytes {
    let verifier = config_of(w).platform.settlement_verifier;
    w.e.invoke_contract(&verifier, &Symbol::new(&w.e, "last_inputs"), vec![&w.e])
}

fn settlement_proof_of(w: &setup::World) -> Bytes {
    let verifier = config_of(w).platform.settlement_verifier;
    w.e.invoke_contract(&verifier, &Symbol::new(&w.e, "last_proof"), vec![&w.e])
}

fn set_settlement_accept(w: &setup::World, accept: bool) {
    let verifier = config_of(w).platform.settlement_verifier;
    let args = vec![&w.e, accept.into_val(&w.e)];
    w.e.invoke_contract::<()>(&verifier, &Symbol::new(&w.e, "set_accept"), args);
}

fn a_settlement_proof(w: &setup::World) -> Bytes {
    Bytes::from_array(&w.e, &[0x5E; 8])
}

#[allow(clippy::type_complexity)]
fn call_settle(
    w: &setup::World,
    caller: &Address,
    bid_index: u32,
    seller_data: &Bytes,
    fee_data: &Bytes,
    refund_data: &Bytes,
    proof: &Bytes,
) -> Result<SettleOutcome, Result<AuctionError, soroban_sdk::InvokeError>> {
    let args = vec![
        &w.e,
        caller.into_val(&w.e),
        bid_index.into_val(&w.e),
        seller_data.into_val(&w.e),
        fee_data.into_val(&w.e),
        refund_data.into_val(&w.e),
        proof.into_val(&w.e),
    ];
    match w.e.try_invoke_contract::<SettleOutcome, AuctionError>(
        &w.auction,
        &Symbol::new(&w.e, "settle"),
        args,
    ) {
        Ok(Ok(outcome)) => Ok(outcome),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(err) => Err(err),
    }
}

pub(super) fn settle(w: &setup::World, caller: &Address, bid_index: u32) -> SettleOutcome {
    let (seller, fee, refund) = legs(w);
    settle_with(
        w,
        caller,
        bid_index,
        &seller,
        &fee,
        &refund,
        &a_settlement_proof(w),
    )
}

#[allow(clippy::too_many_arguments)]
fn settle_with(
    w: &setup::World,
    caller: &Address,
    bid_index: u32,
    seller_data: &Bytes,
    fee_data: &Bytes,
    refund_data: &Bytes,
    proof: &Bytes,
) -> SettleOutcome {
    match call_settle(
        w,
        caller,
        bid_index,
        seller_data,
        fee_data,
        refund_data,
        proof,
    ) {
        Ok(outcome) => outcome,
        Err(Ok(err)) => panic!("settle refused with {err:?}"),
        Err(Err(err)) => panic!("the call did not reach the contract: {err:?}"),
    }
}

#[allow(clippy::too_many_arguments)]
fn settle_err(
    w: &setup::World,
    caller: &Address,
    bid_index: u32,
    seller_data: &Bytes,
    fee_data: &Bytes,
    refund_data: &Bytes,
    proof: &Bytes,
) -> AuctionError {
    match call_settle(
        w,
        caller,
        bid_index,
        seller_data,
        fee_data,
        refund_data,
        proof,
    ) {
        Ok(_) => panic!("settle passed when it should have failed"),
        Err(Ok(err)) => err,
        Err(Err(err)) => panic!("the call did not reach the contract: {err:?}"),
    }
}

fn settle_raw(
    w: &setup::World,
    caller: &Address,
    bid_index: u32,
) -> Result<SettleOutcome, soroban_sdk::InvokeError> {
    let (seller, fee, refund) = legs(w);
    match call_settle(
        w,
        caller,
        bid_index,
        &seller,
        &fee,
        &refund,
        &a_settlement_proof(w),
    ) {
        Ok(outcome) => Ok(outcome),
        Err(Ok(err)) => {
            panic!("the Auction refused with {err:?}, and the test expected the token failure")
        }
        Err(Err(err)) => Err(err),
    }
}

#[derive(Debug, PartialEq)]
struct Snapshot {
    state: MarketStatus,
    status: BidStatus,
    filled: u32,
    open_bids: Option<u32>,
    auction_quotas: i128,
    bidder_quotas: i128,
    reserve: i128,
    legs: u32,
}

fn snapshot(w: &setup::World, bid_index: u32, bidder: &Address) -> Snapshot {
    let record = bid_record_of(w, bid_index);
    Snapshot {
        state: market_state(w),
        status: settlement_status_of(w, bid_index),
        filled: record.filled_quantity,
        open_bids: open_bids_of(w),
        auction_quotas: quota_balance(w, &w.auction),
        bidder_quotas: quota_balance(w, bidder),
        reserve: super::market::fee_reserve_of(w),
        legs: transfers(w).len(),
    }
}

#[test]
fn settle_calls_three_legs_in_order() {
    let (w, bidders) = finalized_with(&[4], &[4]);
    let bidder = bidders.get(0).unwrap();
    let config = config_of(&w);

    settle(&w, &Address::generate(&w.e), 0);

    let calls = transfers(&w);
    assert_eq!(calls.len(), 3, "the three legs always run (D-08)");

    let expected = [
        (&config.seller, SELLER),
        (&config.platform.fee_wallet, FEE),
        (&bidder, REFUND),
    ];

    for (i, (to, xy)) in expected.iter().enumerate() {
        let call = calls.get(i as u32).unwrap();
        assert_eq!(
            &call.spender, &w.auction,
            "leg {i}: the allowance is spent by the Auction, not the bidder"
        );
        assert_eq!(
            &call.from, &bidder,
            "leg {i}: the escrow belongs to the bidder"
        );
        assert_eq!(&call.to, *to, "leg {i}: wrong recipient");
        assert_eq!(
            decoded_c_tx(&w, &call),
            point(&w, *xy),
            "leg {i}: the forwarded c_tx is not the one from the scenario"
        );
    }
}

#[test]
fn settle_delivers_filled_quotas_to_bidder() {
    let (w, bidders) = finalized_with(&[4, 4, 2], &[4, 0, 0]);
    let bidder = bidders.get(0).unwrap();

    assert_eq!(
        quota_balance(&w, &w.auction),
        4i128 * QUOTA_UNIT,
        "after `finalize` only the 4 sold quotas remain in escrow"
    );
    assert_eq!(quota_balance(&w, &bidder), 0);

    settle(&w, &Address::generate(&w.e), 0);

    assert_eq!(quota_balance(&w, &bidder), 4i128 * QUOTA_UNIT);
    assert_eq!(quota_balance(&w, &w.auction), 0);
    assert_eq!(
        quota_balance(&w, &bidders.get(1).unwrap()),
        0,
        "settling one bid does not deliver another's quota"
    );
}

#[test]
fn zero_fill_moves_no_quota() {
    let (w, bidders) = finalized_with(&[4, 4, 2], &[0, 4, 0]);
    let bidder = bidders.get(0).unwrap();
    let escrow = quota_balance(&w, &w.auction);

    settle(&w, &Address::generate(&w.e), 0);

    assert_eq!(quota_balance(&w, &bidder), 0);
    assert_eq!(quota_balance(&w, &w.auction), escrow);
    assert_eq!(
        transfers(&w).len(),
        3,
        "the legs run even with zero value (D-08)"
    );
}

#[test]
fn settlement_inputs_match_circuit_order() {
    let (w, _) = finalized_with(&[4, 4, 2], &[4, 0, 0]);
    let config = config_of(&w);
    let record = bid_record_of(&w, 0);

    settle(&w, &Address::generate(&w.e), 0);

    let sent = settlement_inputs_of(&w);
    assert_eq!(sent.len(), 320, "10 fields of 32 bytes");

    let half = |v: u8| Bytes::from_array(&w.e, &[v; 32]);

    assert_eq!(
        sent.slice(0..32),
        Bytes::from_array(&w.e, &record.commitment.to_array()),
        "0: bid_commitment, from `BidRecord`"
    );
    assert_eq!(
        sent.slice(32..64),
        u32_field(&w, record.requested_quantity),
        "1: requested_quantity, from `BidRecord`"
    );
    assert_eq!(
        sent.slice(64..96),
        u32_field(&w, record.filled_quantity),
        "2: filled_quantity, from `BidRecord`"
    );
    assert_eq!(
        sent.slice(96..128),
        u32_field(&w, config.fee_bps),
        "3: fee_bps, from the frozen config"
    );
    assert_eq!(sent.slice(128..160), half(SELLER.0), "4: c_seller.x");
    assert_eq!(sent.slice(160..192), half(SELLER.1), "5: c_seller.y");
    assert_eq!(sent.slice(192..224), half(FEE.0), "6: c_fee.x");
    assert_eq!(sent.slice(224..256), half(FEE.1), "7: c_fee.y");
    assert_eq!(sent.slice(256..288), half(REFUND.0), "8: c_refund.x");
    assert_eq!(sent.slice(288..320), half(REFUND.1), "9: c_refund.y");

    assert_eq!(
        settlement_proof_of(&w),
        a_settlement_proof(&w),
        "the proof goes along with the public inputs"
    );
}

#[test]
fn c_tx_is_decoded_from_forwarded_bytes() {
    let (w, _) = finalized_with(&[4, 4], &[4, 4]);

    settle(&w, &Address::generate(&w.e), 0);

    let sent = settlement_inputs_of(&w);
    let calls = transfers(&w);
    assert_eq!(calls.len(), 3);

    for (i, at) in [0u32, 1, 2].iter().enumerate() {
        let raw = decoded_c_tx(&w, &calls.get(*at).unwrap()).to_array();

        let base = 128 + (i as u32) * 64;
        assert_eq!(
            sent.slice(base..base + 32),
            Bytes::from_slice(&w.e, &raw[..32]),
            "leg {i}: the public input x is not the x forwarded to the token"
        );
        assert_eq!(
            sent.slice(base + 32..base + 64),
            Bytes::from_slice(&w.e, &raw[32..]),
            "leg {i}: the public input y is not the y forwarded to the token"
        );
    }

    let (seller, fee, refund) = legs(&w);
    settle_with(
        &w,
        &Address::generate(&w.e),
        1,
        &fee,
        &seller,
        &refund,
        &a_settlement_proof(&w),
    );

    let sent = settlement_inputs_of(&w);
    let half = |v: u8| Bytes::from_array(&w.e, &[v; 32]);

    assert_eq!(
        sent.slice(128..160),
        half(FEE.0),
        "4: with the payloads swapped, c_seller.x is the fee's"
    );
    assert_eq!(sent.slice(160..192), half(FEE.1), "5: same for y");
    assert_eq!(
        sent.slice(192..224),
        half(SELLER.0),
        "6: and c_fee.x is the seller's"
    );
    assert_eq!(sent.slice(224..256), half(SELLER.1), "7: same for y");
    assert_eq!(
        sent.slice(256..288),
        half(REFUND.0),
        "8: the refund did not change"
    );
    assert_eq!(sent.slice(288..320), half(REFUND.1), "9: same for y");

    let calls = transfers(&w);
    assert_eq!(calls.len(), 6, "two settlements, three legs each");
    assert_eq!(
        decoded_c_tx(&w, &calls.get(3).unwrap()),
        point(&w, FEE),
        "leg 0 of bid 1: the public input c_tx is the one the leg forwarded"
    );
    assert_eq!(
        decoded_c_tx(&w, &calls.get(4).unwrap()),
        point(&w, SELLER),
        "leg 1 of bid 1: same"
    );
}

#[test]
fn malformed_payload_fails_invalid_transfer_data() {
    let (w, _) = finalized_with(&[4], &[4]);
    let garbage = 7u32.to_xdr(&w.e);
    let (seller, fee, refund) = legs(&w);
    let proof = a_settlement_proof(&w);

    let cases = [
        (garbage.clone(), fee.clone(), refund.clone()),
        (seller.clone(), garbage.clone(), refund.clone()),
        (seller.clone(), fee.clone(), garbage.clone()),
    ];

    for (i, (s, f, r)) in cases.iter().enumerate() {
        assert_eq!(
            settle_err(&w, &Address::generate(&w.e), 0, s, f, r, &proof),
            AuctionError::InvalidTransferData,
            "malformed payload {i} should have been rejected"
        );
    }

    assert_eq!(transfers(&w).len(), 0, "nothing was forwarded to the token");
}

#[test]
fn invalid_proof_fails_and_no_leg_runs() {
    let (w, bidders) = finalized_with(&[4, 4, 2], &[4, 0, 0]);
    let bidder = bidders.get(0).unwrap();
    let before = snapshot(&w, 0, &bidder);

    set_settlement_accept(&w, false);
    let (seller, fee, refund) = legs(&w);
    let proof = a_settlement_proof(&w);

    assert_eq!(
        settle_err(
            &w,
            &Address::generate(&w.e),
            0,
            &seller,
            &fee,
            &refund,
            &proof
        ),
        AuctionError::InvalidSettlementProof
    );
    assert_eq!(
        snapshot(&w, 0, &bidder),
        before,
        "the rejected proof changed the state (guardrail 15)"
    );

    set_settlement_accept(&w, true);
    settle_with(
        &w,
        &Address::generate(&w.e),
        0,
        &seller,
        &fee,
        &refund,
        &proof,
    );

    assert_eq!(bid_record_of(&w, 0).status, BidStatus::Settled);
    assert_eq!(
        transfers(&w).len(),
        3,
        "only the legs of the settle that passed"
    );
    assert_eq!(quota_balance(&w, &bidder), 4i128 * QUOTA_UNIT);
}

#[test]
fn leg_failure_reverts_everything() {
    let (w, bidders) = finalized_with(&[4, 4, 2], &[4, 0, 0]);
    let bidder = bidders.get(0).unwrap();
    let before = snapshot(&w, 0, &bidder);

    set_fail_at(&w, Some(2));
    assert!(
        settle_raw(&w, &Address::generate(&w.e), 0).is_err(),
        "the rejected leg had to bring down the call"
    );

    assert_eq!(
        snapshot(&w, 0, &bidder),
        before,
        "the transaction was not atomic"
    );

    set_fail_at(&w, None);
    settle(&w, &Address::generate(&w.e), 0);

    assert_ne!(snapshot(&w, 0, &bidder), before);
    assert_eq!(bid_record_of(&w, 0).status, BidStatus::Settled);
}

#[test]
fn settle_to_unregistered_seller_reverts_everything() {
    let (w, bidders) = finalized_with(&[4, 4, 2], &[4, 0, 0]);
    let bidder = bidders.get(0).unwrap();
    let before = snapshot(&w, 0, &bidder);

    let token = config_of(&w).platform.collateral_token;
    let seller = config_of(&w).seller;
    w.e.invoke_contract::<()>(
        &token,
        &Symbol::new(&w.e, "close_account"),
        vec![&w.e, seller.into_val(&w.e)],
    );

    assert!(
        settle_raw(&w, &Address::generate(&w.e), 0).is_err(),
        "the token rejects the seller's leg without an account"
    );
    assert_eq!(snapshot(&w, 0, &bidder), before, "the refusal left a trace");
}

#[test]
fn second_settle_returns_already_settled_and_moves_nothing() {
    let (w, bidders) = finalized_with(&[4, 4, 2], &[4, 0, 0]);
    let bidder = bidders.get(0).unwrap();

    assert_eq!(
        settle(&w, &Address::generate(&w.e), 0),
        SettleOutcome::Settled
    );

    let before = snapshot(&w, 0, &bidder);
    let second = Address::generate(&w.e);

    assert_eq!(settle(&w, &second, 0), SettleOutcome::AlreadySettled);
    assert_eq!(
        snapshot(&w, 0, &bidder),
        before,
        "the second settle changed something"
    );
    assert_eq!(
        fee_balance(&w, &second),
        0,
        "AlreadySettled does not reimburse (D-09)"
    );
    assert_eq!(transfers(&w).len(), 3, "only the legs of the first");
}

#[test]
fn settle_is_permissionless() {
    let (w, bidders) = finalized_with(&[4], &[4]);
    let bidder = bidders.get(0).unwrap();
    let stranger = Address::generate(&w.e);

    assert_ne!(stranger, w.seller);
    assert_ne!(stranger, bidder);

    assert_eq!(settle(&w, &stranger, 0), SettleOutcome::Settled);
    assert_eq!(bid_record_of(&w, 0).status, BidStatus::Settled);
    assert_eq!(quota_balance(&w, &bidder), 4i128 * QUOTA_UNIT);
    assert_eq!(
        fee_balance(&w, &stranger),
        REIMBURSEMENT_PER_CALL,
        "the reimbursement goes to the caller, not the seller"
    );

    let (w, _) = finalized_with(&[4], &[4]);
    let keeper = Address::generate(&w.e);
    let impostor = Address::generate(&w.e);
    let (seller, fee, refund) = legs(&w);
    let proof = a_settlement_proof(&w);

    w.e.mock_auths(&[MockAuth {
        address: &impostor,
        invoke: &MockAuthInvoke {
            contract: &w.auction,
            fn_name: "settle",
            args: vec![
                &w.e,
                keeper.into_val(&w.e),
                0u32.into_val(&w.e),
                seller.into_val(&w.e),
                fee.into_val(&w.e),
                refund.into_val(&w.e),
                proof.into_val(&w.e),
            ],
            sub_invokes: &[],
        },
    }]);

    assert!(
        call_settle(&w, &keeper, 0, &seller, &fee, &refund, &proof).is_err(),
        "the reimbursement cannot go to an address that did not sign"
    );
    assert_eq!(bid_record_of(&w, 0).status, BidStatus::Pending);

    w.e.mock_all_auths();
    settle(&w, &keeper, 0);
    assert_eq!(bid_record_of(&w, 0).status, BidStatus::Settled);
}

#[test]
fn settle_before_finalized_fails() {
    let (w, bidders) = closed_with_bidders(&[4]);
    let bidder = bidders.get(0).unwrap();

    let (seller, fee, refund) = legs(&w);
    let proof = a_settlement_proof(&w);

    assert_eq!(
        settle_err(
            &w,
            &Address::generate(&w.e),
            0,
            &seller,
            &fee,
            &refund,
            &proof
        ),
        AuctionError::InvalidState
    );
    assert_eq!(market_state(&w), MarketStatus::Closed);
    assert_eq!(transfers(&w).len(), 0, "no leg ran");
    assert_eq!(quota_balance(&w, &bidder), 0);
}

#[test]
fn settled_event_has_no_amount() {
    let (w, bidders) = finalized_with(&[4, 4, 2], &[4, 0, 0]);
    let bidder = bidders.get(0).unwrap();

    settle(&w, &Address::generate(&w.e), 0);

    let emitted = w.e.events().all().filter_by_contract(&w.auction);

    let mut data: Map<Symbol, Val> = Map::new(&w.e);
    data.set(Symbol::new(&w.e, "bid_index"), 0u32.into_val(&w.e));
    data.set(Symbol::new(&w.e, "filled_quantity"), 4u32.into_val(&w.e));

    let expected = vec![
        &w.e,
        (
            w.auction.clone(),
            vec![
                &w.e,
                Symbol::new(&w.e, "bid_settled").into_val(&w.e),
                bidder.into_val(&w.e),
            ],
            data.into_val(&w.e),
        ),
    ];

    assert_eq!(emitted, expected);
}

#[test]
fn one_bid_failure_does_not_block_another() {
    let (w, bidders) = finalized_with(&[4, 4, 2], &[4, 4, 0]);
    let first = bidders.get(0).unwrap();
    let second = bidders.get(1).unwrap();

    set_fail_at(&w, Some(0));
    assert!(
        settle_raw(&w, &Address::generate(&w.e), 0).is_err(),
        "bid 0 had to fail"
    );
    assert_eq!(bid_record_of(&w, 0).status, BidStatus::Pending);

    set_fail_at(&w, None);
    assert_eq!(
        settle(&w, &Address::generate(&w.e), 1),
        SettleOutcome::Settled
    );

    assert_eq!(bid_record_of(&w, 0).status, BidStatus::Pending);
    assert_eq!(bid_record_of(&w, 1).status, BidStatus::Settled);
    assert_eq!(quota_balance(&w, &first), 0, "bid 0's quotas stay");
    assert_eq!(quota_balance(&w, &second), 4i128 * QUOTA_UNIT);
    assert_eq!(open_bids_of(&w), Some(2), "only bid 1 closed, of the three");
}

pub(super) fn revoke_delegation(w: &setup::World, bidder: &Address) {
    let token = config_of(w).platform.collateral_token;
    let args = vec![
        &w.e,
        bidder.into_val(&w.e),
        w.auction.clone().into_val(&w.e),
    ];
    w.e.invoke_contract::<()>(&token, &Symbol::new(&w.e, "revoke_delegation"), args);
}

fn expire_delegation(w: &setup::World, bidder: &Address) {
    let token = config_of(w).platform.collateral_token;
    let live_until = w.e.ledger().sequence() - 1;
    let args = vec![
        &w.e,
        bidder.into_val(&w.e),
        w.auction.clone().into_val(&w.e),
        live_until.into_val(&w.e),
    ];
    w.e.invoke_contract::<()>(&token, &Symbol::new(&w.e, "set_delegation_expiry"), args);
}

fn call_release(
    w: &setup::World,
    caller: &Address,
    bid_index: u32,
) -> Result<(), Result<AuctionError, soroban_sdk::InvokeError>> {
    let args = vec![&w.e, caller.into_val(&w.e), bid_index.into_val(&w.e)];
    match w.e.try_invoke_contract::<(), AuctionError>(
        &w.auction,
        &Symbol::new(&w.e, "release_unsettled"),
        args,
    ) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(err) => Err(err),
    }
}

pub(super) fn release(w: &setup::World, caller: &Address, bid_index: u32) {
    match call_release(w, caller, bid_index) {
        Ok(()) => {}
        Err(Ok(err)) => panic!("release refused with {err:?}"),
        Err(Err(err)) => panic!("the call did not reach the contract: {err:?}"),
    }
}

fn release_err(w: &setup::World, caller: &Address, bid_index: u32) -> AuctionError {
    match call_release(w, caller, bid_index) {
        Ok(()) => panic!("release passed when it should have failed"),
        Err(Ok(err)) => err,
        Err(Err(err)) => panic!("the call did not reach the contract: {err:?}"),
    }
}

#[test]
fn release_when_delegation_revoked_returns_quotas_to_seller() {
    let (w, bidders) = finalized_with(&[4, 4], &[4, 0]);
    let bidder = bidders.get(0).unwrap();
    let seller_before = quota_balance(&w, &w.seller);
    let auction_before = quota_balance(&w, &w.auction);
    let keeper = Address::generate(&w.e);

    revoke_delegation(&w, &bidder);
    release(&w, &keeper, 0);

    assert_eq!(bid_record_of(&w, 0).status, BidStatus::Failed);
    assert_eq!(
        quota_balance(&w, &w.seller) - seller_before,
        4 * QUOTA_UNIT,
        "the allocated quotas return to the seller"
    );
    assert_eq!(
        quota_balance(&w, &w.auction),
        auction_before - 4 * QUOTA_UNIT
    );
    assert_eq!(
        quota_balance(&w, &bidder),
        0,
        "the bidder did not pay, so they take no quota"
    );
    assert_eq!(open_bids_of(&w), Some(1), "the other bid remains open");
    assert_eq!(
        market_state(&w),
        MarketStatus::Finalized,
        "there is still a bid to close"
    );
    assert_eq!(
        fee_balance(&w, &keeper),
        REIMBURSEMENT_PER_CALL,
        "the call that changes state reimburses the caller (D-04)"
    );
    assert_eq!(
        transfers(&w).len(),
        0,
        "no payment leg runs: there is no delegation to spend"
    );
}

#[test]
fn release_when_delegation_expired_works() {
    let (w, bidders) = finalized_with(&[4, 4], &[4, 0]);
    let bidder = bidders.get(0).unwrap();
    let seller_before = quota_balance(&w, &w.seller);

    expire_delegation(&w, &bidder);
    release(&w, &Address::generate(&w.e), 0);

    assert_eq!(bid_record_of(&w, 0).status, BidStatus::Failed);
    assert_eq!(
        quota_balance(&w, &w.seller) - seller_before,
        4 * QUOTA_UNIT,
        "the quota returns to the seller on expiry as well"
    );
    assert_eq!(open_bids_of(&w), Some(1));
}

#[test]
fn release_with_active_delegation_fails() {
    let (w, bidders) = finalized_with(&[4, 4], &[4, 0]);
    let bidder = bidders.get(0).unwrap();
    let before = snapshot(&w, 0, &bidder);

    assert_eq!(
        release_err(&w, &Address::generate(&w.e), 0),
        AuctionError::DelegationStillActive
    );
    assert_eq!(
        snapshot(&w, 0, &bidder),
        before,
        "the refusal changed nothing"
    );
}

#[test]
fn release_settled_bid_fails_bid_already_closed() {
    let (w, bidders) = finalized_with(&[4, 4], &[4, 0]);
    let settled = bidders.get(0).unwrap();
    let failed = bidders.get(1).unwrap();

    settle(&w, &Address::generate(&w.e), 0);
    revoke_delegation(&w, &settled);
    assert_eq!(
        release_err(&w, &Address::generate(&w.e), 0),
        AuctionError::BidAlreadyClosed,
        "an already settled bid cannot be released"
    );

    revoke_delegation(&w, &failed);
    release(&w, &Address::generate(&w.e), 1);
    assert_eq!(bid_record_of(&w, 1).status, BidStatus::Failed);

    let keeper = Address::generate(&w.e);
    assert_eq!(
        release_err(&w, &keeper, 1),
        AuctionError::BidAlreadyClosed,
        "and neither can an already released one"
    );
    assert_eq!(
        fee_balance(&w, &keeper),
        0,
        "the refusal does not reimburse: whoever changes state pays (D-04)"
    );
}

#[test]
fn market_becomes_settled_when_all_bids_settled_or_failed() {
    let (w, bidders) = finalized_with(&[4, 4, 2], &[4, 4, 0]);
    assert_eq!(market_state(&w), MarketStatus::Finalized);
    assert_eq!(open_bids_of(&w), Some(3));

    settle(&w, &Address::generate(&w.e), 0);
    assert_eq!(
        market_state(&w),
        MarketStatus::Finalized,
        "there are still two open bids"
    );

    revoke_delegation(&w, &bidders.get(1).unwrap());
    release(&w, &Address::generate(&w.e), 1);
    assert_eq!(
        market_state(&w),
        MarketStatus::Finalized,
        "and a third, which can still be settled"
    );

    settle(&w, &Address::generate(&w.e), 2);

    assert_eq!(market_state(&w), MarketStatus::Settled);
    assert_eq!(open_bids_of(&w), Some(0));
    assert_eq!(bid_record_of(&w, 0).status, BidStatus::Settled);
    assert_eq!(bid_record_of(&w, 1).status, BidStatus::Failed);
    assert_eq!(bid_record_of(&w, 2).status, BidStatus::Settled);
}

#[test]
fn remaining_reserve_returns_to_seller_at_settled() {
    let (w, _) = finalized_with(&[4], &[4]);
    let seller_before = fee_balance(&w, &w.seller);
    let keeper = Address::generate(&w.e);

    settle(&w, &keeper, 0);

    assert_eq!(market_state(&w), MarketStatus::Settled);
    assert_eq!(fee_reserve_of(&w), 0, "the entire reserve left");
    assert_eq!(fee_balance(&w, &keeper), REIMBURSEMENT_PER_CALL);
    assert_eq!(
        fee_balance(&w, &w.seller) - seller_before,
        MIN_FEE_RESERVE - 3 * REIMBURSEMENT_PER_CALL,
        "the rest of the reserve: the three reimbursed transitions already left"
    );
}

#[test]
fn reserve_never_goes_negative() {
    let (w, _) = finalized_with(&[1, 1, 1, 1, 1, 1, 1, 1], &[1, 1, 1, 1, 1, 1, 1, 1]);

    let mut reserve = fee_reserve_of(&w);
    assert!(reserve >= 0, "the reserve starts out negative");

    for i in 0..8 {
        settle(&w, &Address::generate(&w.e), i);

        let now = fee_reserve_of(&w);
        assert!(now >= 0, "the reserve went negative on bid {i}: {now}");
        assert!(
            now < reserve,
            "the reserve did not drop on bid {i}: {reserve} -> {now}"
        );
        reserve = now;
    }

    assert_eq!(
        reserve, 0,
        "the ten transitions consume the minimum reserve"
    );
    assert_eq!(market_state(&w), MarketStatus::Settled);
}

#[test]
fn bid_failed_event() {
    let (w, bidders) = finalized_with(&[4, 4], &[4, 0]);
    let bidder = bidders.get(0).unwrap();

    revoke_delegation(&w, &bidder);
    release(&w, &Address::generate(&w.e), 0);

    let emitted = w.e.events().all().filter_by_contract(&w.auction);

    let mut data: Map<Symbol, Val> = Map::new(&w.e);
    data.set(Symbol::new(&w.e, "bid_index"), 0u32.into_val(&w.e));
    data.set(Symbol::new(&w.e, "filled_quantity"), 4u32.into_val(&w.e));

    let expected = vec![
        &w.e,
        (
            w.auction.clone(),
            vec![
                &w.e,
                Symbol::new(&w.e, "bid_failed").into_val(&w.e),
                bidder.into_val(&w.e),
            ],
            data.into_val(&w.e),
        ),
    ];

    assert_eq!(emitted, expected);
}

#[test]
fn market_settled_event() {
    let (w, bidders) = finalized_with(&[4], &[4]);
    let bidder = bidders.get(0).unwrap();

    revoke_delegation(&w, &bidder);
    release(&w, &Address::generate(&w.e), 0);

    let emitted = w.e.events().all().filter_by_contract(&w.auction);

    let mut failed: Map<Symbol, Val> = Map::new(&w.e);
    failed.set(Symbol::new(&w.e, "bid_index"), 0u32.into_val(&w.e));
    failed.set(Symbol::new(&w.e, "filled_quantity"), 4u32.into_val(&w.e));

    let empty: Map<Symbol, Val> = Map::new(&w.e);

    let expected = vec![
        &w.e,
        (
            w.auction.clone(),
            vec![
                &w.e,
                Symbol::new(&w.e, "bid_failed").into_val(&w.e),
                bidder.into_val(&w.e),
            ],
            failed.into_val(&w.e),
        ),
        (
            w.auction.clone(),
            vec![
                &w.e,
                Symbol::new(&w.e, "market_settled").into_val(&w.e),
                config_of(&w).market_id.into_val(&w.e),
            ],
            empty.into_val(&w.e),
        ),
    ];

    assert_eq!(emitted, expected);
}

#[test]
fn settle_in_cancelled_uses_filled_zero() {
    let (w, _) = cancelled_with_bidders(&[4, 4, 2]);
    let keeper = Address::generate(&w.e);

    assert_eq!(
        settlement_status_of(&w, 0),
        BidStatus::Pending,
        "the bid is open for reimbursement, not closed"
    );

    assert_eq!(settle(&w, &keeper, 0), SettleOutcome::Settled);

    let inputs = settlement_inputs_of(&w);
    assert_eq!(inputs.len(), 320, "the ten fields of 32 bytes");
    assert_eq!(
        inputs.slice(64..96),
        u32_field(&w, 0),
        "public input 2 is zero: the cancellation allocated nothing"
    );
    assert_eq!(
        inputs.slice(32..64),
        u32_field(&w, 4),
        "the bid request was not zeroed by the cancellation"
    );
    assert_eq!(
        settlement_status_of(&w, 0),
        BidStatus::Settled,
        "and the bid closed as settled"
    );
}

#[test]
fn settle_in_cancelled_moves_no_quota() {
    let (w, bidders) = cancelled_with_bidders(&[4, 4, 2]);
    let keeper = Address::generate(&w.e);

    assert_eq!(market_state(&w), MarketStatus::Cancelled);
    assert_eq!(
        quota_balance(&w, &w.auction),
        0,
        "`cancel_expired` already returned the entire escrow"
    );

    for i in 0..3u32 {
        assert_eq!(settle(&w, &keeper, i), SettleOutcome::Settled);
    }

    assert_eq!(
        quota_balance(&w, &w.auction),
        0,
        "no quota returned to escrow"
    );
    for (i, bidder) in bidders.iter().enumerate() {
        assert_eq!(
            quota_balance(&w, &bidder),
            0,
            "bid {i} received a quota in a market that sold nothing"
        );
    }
}

#[test]
fn release_in_cancelled_marks_failed_without_quota_move() {
    let (w, bidders) = cancelled_with_bidders(&[4, 4, 2]);
    let bidder = bidders.get(0).unwrap();
    let seller_before = quota_balance(&w, &w.seller);
    let keeper = Address::generate(&w.e);

    revoke_delegation(&w, &bidder);
    release(&w, &keeper, 0);

    assert_eq!(bid_record_of(&w, 0).status, BidStatus::Failed);
    assert_eq!(settlement_status_of(&w, 0), BidStatus::Failed);
    assert_eq!(
        quota_balance(&w, &w.seller),
        seller_before,
        "the seller does not return what was already theirs"
    );
    assert_eq!(quota_balance(&w, &w.auction), 0);
    assert_eq!(
        open_bids_of(&w),
        Some(2),
        "the bid closed and the counter dropped: two remain open"
    );
}

#[test]
fn cancelled_market_returns_reserve_after_last_bid() {
    let (w, bidders) = cancelled_with_bidders(&[4, 4, 2]);
    let keeper = Address::generate(&w.e);
    let seller_before = fee_balance(&w, &w.seller);

    revoke_delegation(&w, &bidders.get(0).unwrap());
    release(&w, &keeper, 0);
    assert_eq!(
        settle(&w, &keeper, 1),
        SettleOutcome::Settled,
        "the last two bids still have a live delegation"
    );
    assert_eq!(
        open_bids_of(&w),
        Some(1),
        "with one bid open, the market is not over yet"
    );
    assert!(
        fee_reserve_of(&w) > 0,
        "and the reserve is still in the contract, paying for the remaining ones"
    );

    assert_eq!(settle(&w, &keeper, 2), SettleOutcome::Settled);

    assert_eq!(
        market_state(&w),
        MarketStatus::Cancelled,
        "the market was not judged, and `Cancelled` does not become `Settled`"
    );
    assert_eq!(open_bids_of(&w), Some(0));
    assert_eq!(fee_reserve_of(&w), 0, "no reserve was left in the contract");
    assert_eq!(
        fee_balance(&w, &w.seller) - seller_before,
        MIN_FEE_RESERVE - 5 * REIMBURSEMENT_PER_CALL,
        "the rest of the reserve, after the five reimbursed transitions"
    );
    assert_eq!(
        fee_balance(&w, &keeper),
        3 * REIMBURSEMENT_PER_CALL,
        "the keeper was reimbursed on the three they called"
    );
}
