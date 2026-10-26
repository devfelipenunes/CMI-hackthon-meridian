use shared::types::{
    BidRecord, BidStatus, MarketConfig, MarketParams, PlatformConfig, AUCTION_RULE, FEE_BPS,
    FINALIZATION_GRACE_LEDGERS, MAX_BIDS, MIN_FEE_RESERVE, QUOTA_UNIT, REIMBURSEMENT_PER_CALL,
};
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke};
use soroban_sdk::token::TokenClient;
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contract, contractimpl, vec, Address, Bytes, BytesN, Env, IntoVal, Map, Symbol, Val, Vec,
};

use crate::crypto;
use crate::market::{self, read_state, transition};
use crate::types::{AuctionError, DataKey, MarketStatus};

use super::bidding::{u32_field, u64_field};
use super::setup;

#[contract]
pub struct StateHarness;

#[contractimpl]
impl StateHarness {
    pub fn transition(e: Env, to: MarketStatus) {
        transition(&e, to);
    }

    pub fn state(e: Env) -> MarketStatus {
        read_state(&e)
    }

    pub fn set_state(e: Env, from: MarketStatus) {
        e.storage().instance().set(&DataKey::State, &from);
    }
}

const ALL: [MarketStatus; 6] = [
    MarketStatus::Created,
    MarketStatus::Open,
    MarketStatus::Closed,
    MarketStatus::Finalized,
    MarketStatus::Settled,
    MarketStatus::Cancelled,
];

const LEGAL: [(MarketStatus, MarketStatus); 7] = [
    (MarketStatus::Created, MarketStatus::Open),
    (MarketStatus::Created, MarketStatus::Cancelled),
    (MarketStatus::Open, MarketStatus::Closed),
    (MarketStatus::Open, MarketStatus::Cancelled),
    (MarketStatus::Closed, MarketStatus::Finalized),
    (MarketStatus::Closed, MarketStatus::Cancelled),
    (MarketStatus::Finalized, MarketStatus::Settled),
];

fn is_legal_pair(from: MarketStatus, to: MarketStatus) -> bool {
    LEGAL.contains(&(from, to))
}

fn harness_config(e: &Env) -> MarketConfig {
    MarketConfig {
        market_id: 1,
        seller: Address::generate(e),
        params: MarketParams {
            quota_asset: Address::generate(e),
            total_quotas: 10,
            min_price_per_quota: 100,
            close_ledger: 1_000,
            eligibility_policy: None,
            fee_reserve: MIN_FEE_RESERVE,
        },
        platform: PlatformConfig {
            collateral_token: Address::generate(e),
            fee_asset: Address::generate(e),
            bid_verifier: Address::generate(e),
            allocation_verifier: Address::generate(e),
            settlement_verifier: Address::generate(e),
            fee_wallet: Address::generate(e),
            auditor_id: 0,
            finalization_grace_ledgers: shared::types::FINALIZATION_GRACE_LEDGERS,
        },
        finalization_grace_ledgers: FINALIZATION_GRACE_LEDGERS,
        fee_bps: FEE_BPS,
        auction_rule: AUCTION_RULE,
        max_bids: MAX_BIDS,
    }
}

fn harness(e: &Env, from: Option<MarketStatus>) -> Address {
    let addr = e.register(StateHarness, ());
    let config = harness_config(e);
    e.as_contract(&addr, || market::write_config(e, &config));

    if let Some(state) = from {
        let args = vec![e, state.into_val(e)];
        e.invoke_contract::<()>(&addr, &Symbol::new(e, "set_state"), args);
    }
    addr
}

fn try_transition(e: &Env, addr: &Address, to: MarketStatus) -> Result<(), AuctionError> {
    let args = vec![e, to.into_val(e)];
    match e.try_invoke_contract::<(), AuctionError>(addr, &Symbol::new(e, "transition"), args) {
        Ok(Ok(())) => Ok(()),

        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(Ok(err)) => Err(err),
        Err(Err(_)) => panic!("the call did not reach the contract"),
    }
}

fn state_of(e: &Env, addr: &Address) -> Result<MarketStatus, AuctionError> {
    match e.try_invoke_contract::<MarketStatus, AuctionError>(
        addr,
        &Symbol::new(e, "state"),
        Vec::new(e),
    ) {
        Ok(Ok(state)) => Ok(state),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(Ok(err)) => Err(err),
        Err(Err(_)) => panic!("the call did not reach the contract"),
    }
}

#[test]
fn legal_transitions_succeed() {
    let e = Env::default();

    for (from, to) in LEGAL {
        let addr = harness(&e, Some(from));
        assert_eq!(
            try_transition(&e, &addr, to),
            Ok(()),
            "{from:?} -> {to:?} is legal and should pass"
        );
        assert_eq!(
            state_of(&e, &addr),
            Ok(to),
            "the state stored after {from:?} -> {to:?} should be {to:?}"
        );
    }
}

#[test]
fn illegal_transitions_fail_with_invalid_state() {
    let e = Env::default();
    let mut barred = 0;

    for from in ALL {
        for to in ALL {
            if is_legal_pair(from, to) {
                continue;
            }
            barred += 1;

            let addr = harness(&e, Some(from));
            assert_eq!(
                try_transition(&e, &addr, to),
                Err(AuctionError::InvalidState),
                "{from:?} -> {to:?} is not in RF-03 and should be barred"
            );
            assert_eq!(
                state_of(&e, &addr),
                Ok(from),
                "{from:?} -> {to:?} was barred but changed the state"
            );
        }
    }

    assert_eq!(
        barred,
        36 - LEGAL.len(),
        "the 6x6 matrix should give 29 pairs"
    );
}

#[test]
fn terminal_states_never_transition() {
    let e = Env::default();

    for from in [MarketStatus::Settled, MarketStatus::Cancelled] {
        for to in ALL {
            let addr = harness(&e, Some(from));
            assert_eq!(
                try_transition(&e, &addr, to),
                Err(AuctionError::InvalidState),
                "{from:?} is terminal and cannot go to {to:?}"
            );
            assert_eq!(state_of(&e, &addr), Ok(from), "{to:?} changed the state");
        }
    }
}

#[test]
fn finalized_cannot_go_back_to_closed() {
    let e = Env::default();
    let addr = harness(&e, Some(MarketStatus::Finalized));

    assert_eq!(
        try_transition(&e, &addr, MarketStatus::Closed),
        Err(AuctionError::InvalidState)
    );
    assert_eq!(state_of(&e, &addr), Ok(MarketStatus::Finalized));
}

#[test]
fn no_reopen() {
    let e = Env::default();

    for from in [
        MarketStatus::Open,
        MarketStatus::Closed,
        MarketStatus::Finalized,
        MarketStatus::Settled,
        MarketStatus::Cancelled,
    ] {
        let addr = harness(&e, Some(from));
        assert_eq!(
            try_transition(&e, &addr, MarketStatus::Open),
            Err(AuctionError::InvalidState),
            "{from:?} -> Open would reopen the bidding window"
        );
        assert_eq!(state_of(&e, &addr), Ok(from));
    }
}

#[test]
fn absent_state_is_invalid() {
    let e = Env::default();
    let addr = e.register(StateHarness, ());

    assert_eq!(state_of(&e, &addr), Err(AuctionError::InvalidState));
    assert_eq!(
        try_transition(&e, &addr, MarketStatus::Open),
        Err(AuctionError::InvalidState)
    );
}

pub(super) fn open(w: &setup::World) {
    super::invoke::<()>(&w.e, &w.auction, "open_market");
}

#[allow(clippy::type_complexity)]
fn call_open(w: &setup::World) -> Result<(), Result<AuctionError, soroban_sdk::InvokeError>> {
    match w.e.try_invoke_contract::<(), AuctionError>(
        &w.auction,
        &Symbol::new(&w.e, "open_market"),
        Vec::new(&w.e),
    ) {
        Ok(Ok(())) => Ok(()),

        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(err) => Err(err),
    }
}

fn open_err(w: &setup::World) -> AuctionError {
    match call_open(w) {
        Ok(()) => panic!("open_market passed when it should have failed"),
        Err(Ok(err)) => err,
        Err(Err(err)) => panic!("the call did not reach the contract: {err:?}"),
    }
}

pub(super) fn config_of(w: &setup::World) -> MarketConfig {
    super::invoke::<MarketConfig>(&w.e, &w.auction, "get_market")
}

pub(super) fn market_state(w: &setup::World) -> MarketStatus {
    super::invoke::<MarketStatus>(&w.e, &w.auction, "get_state")
}

pub(super) fn config_hash_of(w: &setup::World) -> Option<BytesN<32>> {
    super::invoke::<Option<BytesN<32>>>(&w.e, &w.auction, "get_config_hash")
}

pub(super) fn quota_balance(w: &setup::World, who: &Address) -> i128 {
    TokenClient::new(&w.e, &w.quota_asset).balance(who)
}

pub(super) fn escrow(w: &setup::World) -> i128 {
    config_of(w).params.total_quotas as i128 * QUOTA_UNIT
}

pub(super) fn funded_world() -> setup::World {
    let w = setup::new_world();
    w.fund(&w.seller, escrow(&w) * 3);
    w
}

#[test]
fn open_moves_exactly_total_quotas_times_unit() {
    let w = funded_world();
    let value = escrow(&w);

    let seller_before = quota_balance(&w, &w.seller);
    let auction_before = quota_balance(&w, &w.auction);

    open(&w);

    assert_eq!(quota_balance(&w, &w.seller), seller_before - value);
    assert_eq!(quota_balance(&w, &w.auction), auction_before + value);
}

#[test]
fn open_sets_state_open_and_stores_config_hash() {
    let w = funded_world();

    assert_eq!(config_hash_of(&w), None);

    open(&w);

    assert_eq!(market_state(&w), MarketStatus::Open);
    assert_eq!(
        config_hash_of(&w),
        Some(crypto::config_hash(&w.e, &config_of(&w)))
    );
}

#[test]
fn open_requires_seller_auth() {
    let w = funded_world();

    let impostor = Address::generate(&w.e);
    w.e.mock_auths(&[MockAuth {
        address: &impostor,
        invoke: &MockAuthInvoke {
            contract: &w.auction,
            fn_name: "open_market",
            args: Vec::new(&w.e),
            sub_invokes: &[],
        },
    }]);

    assert!(
        call_open(&w).is_err(),
        "an impostor cannot open the market on behalf of the seller"
    );
    assert_eq!(market_state(&w), MarketStatus::Created);
    assert_eq!(quota_balance(&w, &w.auction), 0);
}

#[test]
fn open_twice_fails_invalid_state() {
    let w = funded_world();
    open(&w);

    let seller_before = quota_balance(&w, &w.seller);
    assert_eq!(open_err(&w), AuctionError::InvalidState);

    assert_eq!(market_state(&w), MarketStatus::Open);
    assert_eq!(quota_balance(&w, &w.seller), seller_before);
    assert_eq!(quota_balance(&w, &w.auction), escrow(&w));
}

#[test]
fn open_without_seller_balance_fails_and_state_stays_created() {
    let w = setup::new_world();

    assert!(
        call_open(&w).is_err(),
        "opening without deposited quotas cannot pass"
    );

    assert_eq!(market_state(&w), MarketStatus::Created);
    assert_eq!(config_hash_of(&w), None);
}

#[test]
fn config_hash_is_deterministic() {
    let w = setup::new_world();
    let config = config_of(&w);

    let first = crypto::config_hash(&w.e, &config);
    let second = crypto::config_hash(&w.e, &config_of(&w));

    assert_eq!(first, second, "the same config must give the same hash");
}

fn variant(base: &MarketConfig, mutate: impl FnOnce(&mut MarketConfig)) -> MarketConfig {
    let mut config = base.clone();
    mutate(&mut config);
    config
}

#[test]
fn config_hash_changes_with_each_field() {
    let w = setup::new_world();
    let base = config_of(&w);
    let base_hash = crypto::config_hash(&w.e, &base);

    let cases: [(&str, MarketConfig); 18] = [
        ("market_id", variant(&base, |c| c.market_id += 1)),
        (
            "seller",
            variant(&base, |c| c.seller = Address::generate(&w.e)),
        ),
        (
            "params.quota_asset",
            variant(&base, |c| c.params.quota_asset = Address::generate(&w.e)),
        ),
        (
            "platform.fee_asset",
            variant(&base, |c| c.platform.fee_asset = Address::generate(&w.e)),
        ),
        (
            "platform.collateral_token",
            variant(&base, |c| {
                c.platform.collateral_token = Address::generate(&w.e)
            }),
        ),
        (
            "params.total_quotas",
            variant(&base, |c| c.params.total_quotas += 1),
        ),
        (
            "params.min_price_per_quota",
            variant(&base, |c| c.params.min_price_per_quota += 1),
        ),
        (
            "params.close_ledger",
            variant(&base, |c| c.params.close_ledger += 1),
        ),
        (
            "params.eligibility_policy",
            variant(&base, |c| {
                c.params.eligibility_policy = Some(Address::generate(&w.e))
            }),
        ),
        (
            "finalization_grace_ledgers",
            variant(&base, |c| c.finalization_grace_ledgers += 1),
        ),
        (
            "platform.bid_verifier",
            variant(&base, |c| c.platform.bid_verifier = Address::generate(&w.e)),
        ),
        (
            "platform.allocation_verifier",
            variant(&base, |c| {
                c.platform.allocation_verifier = Address::generate(&w.e)
            }),
        ),
        (
            "platform.settlement_verifier",
            variant(&base, |c| {
                c.platform.settlement_verifier = Address::generate(&w.e)
            }),
        ),
        (
            "platform.fee_wallet",
            variant(&base, |c| c.platform.fee_wallet = Address::generate(&w.e)),
        ),
        (
            "platform.auditor_id",
            variant(&base, |c| c.platform.auditor_id += 1),
        ),
        ("auction_rule", variant(&base, |c| c.auction_rule += 1)),
        ("max_bids", variant(&base, |c| c.max_bids -= 1)),
        ("fee_bps", variant(&base, |c| c.fee_bps += 1)),
    ];

    for (field, config) in cases {
        assert_ne!(
            crypto::config_hash(&w.e, &config),
            base_hash,
            "the `config_hash` stayed the same after changing `{field}`"
        );
    }
}

#[test]
fn config_hash_vector() {
    let w = setup::new_world();
    let config = config_of(&w);
    let xdr = config.clone().to_xdr(&w.e);
    let hash = crypto::config_hash(&w.e, &config);
    let (lo, hi) = crypto::hash_limbs(&w.e, &hash);

    let json = std::format!(
        "{{\n  \
         \"note\": \"config_hash = sha256(canonical XDR of MarketConfig); lo/hi in the circuit \
         encoding (32 bytes big-endian). Checked by the `config_hash_vector` test; to regenerate, \
         UPDATE_VECTORS=1.\",\n  \
         \"config_xdr\": \"{}\",\n  \
         \"config_hash\": \"{}\",\n  \
         \"lo\": \"{}\",\n  \
         \"hi\": \"{}\"\n\
         }}\n",
        hex(xdr.iter()),
        hex(hash.to_array()),
        hex(lo.iter()),
        hex(hi.iter()),
    );

    let dir = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../artifacts/parity-vectors"
    );
    let path = std::format!("{dir}/config_hash.json");

    if std::env::var("UPDATE_VECTORS").as_deref() == Ok("1") {
        std::fs::create_dir_all(dir).expect("create artifacts/parity-vectors");
        std::fs::write(&path, &json).expect("write config_hash.json");
    }

    let committed = std::fs::read_to_string(&path).expect(
        "read artifacts/parity-vectors/config_hash.json - to generate: UPDATE_VECTORS=1 cargo test config_hash_vector",
    );

    let computed = [
        ("config_xdr", hex(xdr.iter())),
        ("config_hash", hex(hash.to_array())),
        ("lo", hex(lo.iter())),
        ("hi", hex(hi.iter())),
    ];
    for (field, expected) in computed {
        assert_eq!(
            json_field(&committed, field),
            expected,
            "the `{field}` in the versioned vector is not what the contract computes now"
        );
    }
}

fn json_field(json: &str, key: &str) -> std::string::String {
    let needle = std::format!("\"{key}\": \"");
    let Some((_, rest)) = json.split_once(needle.as_str()) else {
        panic!("the versioned vector has no key `{key}`");
    };
    let Some((value, _)) = rest.split_once('"') else {
        panic!("the key `{key}` is missing closing quotes");
    };
    std::string::String::from(value)
}

fn hex(bytes: impl IntoIterator<Item = u8>) -> std::string::String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = std::string::String::new();
    for byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    out
}

#[test]
fn market_opened_event() {
    let w = funded_world();
    open(&w);

    let emitted = w.e.events().all().filter_by_contract(&w.auction);

    let config = config_of(&w);

    let mut data: Map<Symbol, Val> = Map::new(&w.e);
    data.set(
        Symbol::new(&w.e, "config_hash"),
        crypto::config_hash(&w.e, &config).into_val(&w.e),
    );
    data.set(
        Symbol::new(&w.e, "total_quotas"),
        config.params.total_quotas.into_val(&w.e),
    );

    let expected = vec![
        &w.e,
        (
            w.auction.clone(),
            vec![
                &w.e,
                Symbol::new(&w.e, "market_opened").into_val(&w.e),
                config.market_id.into_val(&w.e),
            ],
            data.into_val(&w.e),
        ),
    ];

    assert_eq!(emitted, expected);
}

#[test]
fn no_config_mutation_entrypoint_exists() {
    let w = funded_world();
    let before = config_of(&w);

    open(&w);
    assert_eq!(
        config_of(&w),
        before,
        "`open_market` changed the frozen config"
    );

    cancel(&w);
    assert_eq!(
        config_of(&w),
        before,
        "`cancel_market` changed the frozen config"
    );

    let (w, _) = open_with(1, 1);
    let before = config_of(&w);
    at_ledger(&w, close_ledger(&w));

    close(&w, &Address::generate(&w.e));
    assert_eq!(
        config_of(&w),
        before,
        "`close_market` changed the frozen config"
    );
}

pub(super) fn cancel(w: &setup::World) {
    super::invoke::<()>(&w.e, &w.auction, "cancel_market");
}

#[allow(clippy::type_complexity)]
fn call_cancel(w: &setup::World) -> Result<(), Result<AuctionError, soroban_sdk::InvokeError>> {
    match w.e.try_invoke_contract::<(), AuctionError>(
        &w.auction,
        &Symbol::new(&w.e, "cancel_market"),
        Vec::new(&w.e),
    ) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(err) => Err(err),
    }
}

fn cancel_err(w: &setup::World) -> AuctionError {
    match call_cancel(w) {
        Ok(()) => panic!("cancel_market passed when it should have failed"),
        Err(Ok(err)) => err,
        Err(Err(err)) => panic!("the call did not reach the contract: {err:?}"),
    }
}

pub(super) fn fee_balance(w: &setup::World, who: &Address) -> i128 {
    TokenClient::new(&w.e, &w.fee_asset).balance(who)
}

fn seed(w: &setup::World, f: impl FnOnce(&Env)) {
    w.e.as_contract(&w.auction, || f(&w.e));
}

fn set_state(w: &setup::World, state: MarketStatus) {
    seed(w, |e| {
        e.storage().instance().set(&DataKey::State, &state);
    });
}

#[test]
fn cancel_in_created_returns_fee_reserve() {
    let w = setup::new_world();

    cancel(&w);

    assert_eq!(market_state(&w), MarketStatus::Cancelled);
    assert_eq!(fee_balance(&w, &w.seller), MIN_FEE_RESERVE);
    assert_eq!(fee_balance(&w, &w.auction), 0);
    assert_eq!(quota_balance(&w, &w.auction), 0);
}

#[test]
fn cancel_in_open_without_bids_returns_quotas_and_reserve() {
    let w = funded_world();
    let funded = quota_balance(&w, &w.seller);
    open(&w);

    assert_eq!(quota_balance(&w, &w.seller), funded - escrow(&w));
    assert_eq!(quota_balance(&w, &w.auction), escrow(&w));

    cancel(&w);

    assert_eq!(market_state(&w), MarketStatus::Cancelled);
    assert_eq!(quota_balance(&w, &w.seller), funded);
    assert_eq!(quota_balance(&w, &w.auction), 0);
    assert_eq!(fee_balance(&w, &w.seller), MIN_FEE_RESERVE);
    assert_eq!(fee_balance(&w, &w.auction), 0);
}

#[test]
fn cancel_with_bids_fails_has_bids() {
    let w = funded_world();
    open(&w);

    let ana = Address::generate(&w.e);
    super::bidding::register(&w, &ana);
    super::bidding::submit(&w, &ana, &super::bidding::a_bid(&w, 1, 1));

    assert_eq!(cancel_err(&w), AuctionError::HasBids);

    assert_eq!(market_state(&w), MarketStatus::Open);
    assert_eq!(quota_balance(&w, &w.auction), escrow(&w));
    assert_eq!(fee_balance(&w, &w.auction), MIN_FEE_RESERVE);
}

#[test]
fn cancel_requires_seller_auth() {
    let w = setup::new_world();

    let impostor = Address::generate(&w.e);
    w.e.mock_auths(&[MockAuth {
        address: &impostor,
        invoke: &MockAuthInvoke {
            contract: &w.auction,
            fn_name: "cancel_market",
            args: Vec::new(&w.e),
            sub_invokes: &[],
        },
    }]);

    assert!(
        call_cancel(&w).is_err(),
        "an impostor cannot cancel the market on behalf of the seller"
    );
    assert_eq!(market_state(&w), MarketStatus::Created);
    assert_eq!(fee_balance(&w, &w.auction), MIN_FEE_RESERVE);
}

#[test]
fn cancel_after_close_fails_invalid_state() {
    let w = funded_world();
    open(&w);

    for state in [
        MarketStatus::Closed,
        MarketStatus::Finalized,
        MarketStatus::Settled,
        MarketStatus::Cancelled,
    ] {
        set_state(&w, state);

        assert_eq!(
            cancel_err(&w),
            AuctionError::InvalidState,
            "the seller does not cancel a market in {state:?}"
        );
        assert_eq!(
            market_state(&w),
            state,
            "`{state:?}` was barred but changed"
        );
    }
}

#[test]
fn market_cancelled_event_reason_seller() {
    let w = setup::new_world();
    cancel(&w);

    let emitted = w.e.events().all().filter_by_contract(&w.auction);

    let mut data: Map<Symbol, Val> = Map::new(&w.e);
    data.set(
        Symbol::new(&w.e, "reason"),
        Symbol::new(&w.e, "seller").into_val(&w.e),
    );

    let expected = vec![
        &w.e,
        (
            w.auction.clone(),
            vec![
                &w.e,
                Symbol::new(&w.e, "market_cancelled").into_val(&w.e),
                config_of(&w).market_id.into_val(&w.e),
            ],
            data.into_val(&w.e),
        ),
    ];

    assert_eq!(emitted, expected);
}

pub(super) fn close(w: &setup::World, caller: &Address) {
    let args = vec![&w.e, caller.into_val(&w.e)];
    w.e.invoke_contract::<()>(&w.auction, &Symbol::new(&w.e, "close_market"), args);
}

#[allow(clippy::type_complexity)]
fn call_close(
    w: &setup::World,
    caller: &Address,
) -> Result<(), Result<AuctionError, soroban_sdk::InvokeError>> {
    let args = vec![&w.e, caller.into_val(&w.e)];
    match w.e.try_invoke_contract::<(), AuctionError>(
        &w.auction,
        &Symbol::new(&w.e, "close_market"),
        args,
    ) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(err) => Err(err),
    }
}

fn close_err(w: &setup::World, caller: &Address) -> AuctionError {
    match call_close(w, caller) {
        Ok(()) => panic!("close_market passed when it should have failed"),
        Err(Ok(err)) => err,
        Err(Err(err)) => panic!("the call did not reach the contract: {err:?}"),
    }
}

pub(super) fn root_of(w: &setup::World) -> Option<BytesN<32>> {
    super::invoke::<Option<BytesN<32>>>(&w.e, &w.auction, "get_commitments_root")
}

pub(super) fn finalize_by_of(w: &setup::World) -> Option<u32> {
    super::invoke::<Option<u32>>(&w.e, &w.auction, "get_finalize_by_ledger")
}

pub(super) fn fee_reserve_of(w: &setup::World) -> i128 {
    super::invoke::<i128>(&w.e, &w.auction, "get_fee_reserve")
}

pub(super) fn bid_count_of(w: &setup::World) -> u32 {
    super::invoke::<u32>(&w.e, &w.auction, "get_bid_count")
}

pub(super) fn bid_record_of(w: &setup::World, bid_index: u32) -> BidRecord {
    let args = vec![&w.e, bid_index.into_val(&w.e)];
    w.e.invoke_contract(&w.auction, &Symbol::new(&w.e, "get_bid_record"), args)
}

pub(super) fn at_ledger(w: &setup::World, ledger: u32) {
    w.e.ledger().with_mut(|li| li.sequence_number = ledger);
}

pub(super) fn close_ledger(w: &setup::World) -> u32 {
    config_of(w).params.close_ledger
}

fn open_with(bidders: u32, bids: u32) -> (setup::World, Vec<Address>) {
    assert!(bids <= bidders, "one bid per participant, at most");

    let w = funded_world();
    open(&w);

    let mut bidders_addr = Vec::new(&w.e);
    for i in 0..bidders {
        let bidder = Address::generate(&w.e);
        super::bidding::register(&w, &bidder);
        if i < bids {
            super::bidding::submit(&w, &bidder, &super::bidding::a_bid(&w, 1, (i + 1) as u8));
        }
        bidders_addr.push_back(bidder);
    }

    (w, bidders_addr)
}

fn expected_root(w: &setup::World, bids: u32) -> BytesN<32> {
    let mut commitments = Vec::new(&w.e);
    for i in 0..bids {
        commitments.push_back(BytesN::from_array(&w.e, &[(i + 1) as u8; 32]));
    }
    crypto::commitments_root(&w.e, &commitments)
}

#[test]
fn close_before_close_ledger_fails_too_early() {
    let (w, _) = open_with(2, 2);
    at_ledger(&w, close_ledger(&w) - 1);

    let keeper = Address::generate(&w.e);
    assert_eq!(close_err(&w, &keeper), AuctionError::TooEarly);

    assert_eq!(market_state(&w), MarketStatus::Open);
    assert_eq!(root_of(&w), None);
    assert_eq!(finalize_by_of(&w), None);
    assert_eq!(fee_balance(&w, &keeper), 0, "the failed call pays nothing");
    assert_eq!(fee_balance(&w, &w.auction), MIN_FEE_RESERVE);
}

#[test]
fn anyone_can_close_at_close_ledger() {
    let (w, _) = open_with(2, 2);
    at_ledger(&w, close_ledger(&w));

    let stranger = Address::generate(&w.e);
    assert_ne!(stranger, w.seller);

    close(&w, &stranger);

    assert_eq!(market_state(&w), MarketStatus::Closed);
    assert_eq!(root_of(&w), Some(expected_root(&w, 2)));
}

#[test]
fn close_requires_caller_auth() {
    let (w, _) = open_with(1, 1);
    at_ledger(&w, close_ledger(&w));

    let keeper = Address::generate(&w.e);
    let impostor = Address::generate(&w.e);
    w.e.mock_auths(&[MockAuth {
        address: &impostor,
        invoke: &MockAuthInvoke {
            contract: &w.auction,
            fn_name: "close_market",
            args: vec![&w.e, keeper.into_val(&w.e)],
            sub_invokes: &[],
        },
    }]);

    assert!(
        call_close(&w, &keeper).is_err(),
        "the reimbursement cannot go to an address that did not sign"
    );
    assert_eq!(market_state(&w), MarketStatus::Open);

    w.e.mock_all_auths();
    close(&w, &keeper);
    assert_eq!(market_state(&w), MarketStatus::Closed);
}

#[test]
fn close_with_zero_bids_cancels() {
    let w = funded_world();
    let funded = quota_balance(&w, &w.seller);
    open(&w);
    at_ledger(&w, close_ledger(&w));

    let keeper = Address::generate(&w.e);
    close(&w, &keeper);

    assert_eq!(market_state(&w), MarketStatus::Cancelled);
    assert_eq!(quota_balance(&w, &w.seller), funded);
    assert_eq!(quota_balance(&w, &w.auction), 0);

    assert_eq!(fee_balance(&w, &keeper), REIMBURSEMENT_PER_CALL);
    assert_eq!(
        fee_balance(&w, &w.seller),
        MIN_FEE_RESERVE - REIMBURSEMENT_PER_CALL
    );
    assert_eq!(fee_balance(&w, &w.auction), 0);
    assert_eq!(fee_reserve_of(&w), 0);

    assert_eq!(root_of(&w), None);
    assert_eq!(finalize_by_of(&w), None);
}

#[test]
fn undersubscribed_market_closes_normally() {
    let (w, _) = open_with(1, 1);
    at_ledger(&w, close_ledger(&w));

    let keeper = Address::generate(&w.e);
    close(&w, &keeper);

    assert_eq!(market_state(&w), MarketStatus::Closed);
    assert_eq!(root_of(&w), Some(expected_root(&w, 1)));
    assert_eq!(bid_count_of(&w), 1);

    assert_eq!(quota_balance(&w, &w.auction), escrow(&w));
    assert_eq!(fee_balance(&w, &w.seller), 0);
    assert_eq!(fee_reserve_of(&w), MIN_FEE_RESERVE - REIMBURSEMENT_PER_CALL);
}

#[test]
fn close_computes_root_from_stored_commitments() {
    let (w, _) = open_with(3, 3);
    at_ledger(&w, close_ledger(&w));
    close(&w, &Address::generate(&w.e));

    assert_eq!(root_of(&w), Some(expected_root(&w, 3)));

    for i in 0..3u32 {
        assert_eq!(
            bid_record_of(&w, i).commitment,
            BytesN::from_array(&w.e, &[(i + 1) as u8; 32])
        );
    }

    assert_ne!(expected_root(&w, 3), expected_root(&w, 2));
    assert_ne!(
        expected_root(&w, 3),
        crypto::commitments_root(&w.e, &Vec::new(&w.e))
    );
}

#[test]
fn close_sets_finalize_by_to_close_plus_grace() {
    let (w, _) = open_with(1, 1);
    at_ledger(&w, close_ledger(&w));
    close(&w, &Address::generate(&w.e));

    assert_eq!(
        finalize_by_of(&w),
        Some(close_ledger(&w) + FINALIZATION_GRACE_LEDGERS)
    );
}

#[test]
fn bid_after_close_fails() {
    let (w, bidders) = open_with(2, 1);
    at_ledger(&w, close_ledger(&w));
    close(&w, &Address::generate(&w.e));

    let atrasado = &bidders.get(1).unwrap();
    assert_eq!(
        super::bidding::submit_err(&w, atrasado, &super::bidding::a_bid(&w, 1, 9)),
        AuctionError::InvalidState
    );

    assert_eq!(bid_count_of(&w), 1);
    assert_eq!(market_state(&w), MarketStatus::Closed);
}

#[test]
fn root_and_quantities_frozen_after_close() {
    let (w, bidders) = open_with(3, 3);
    at_ledger(&w, close_ledger(&w));
    let keeper = Address::generate(&w.e);
    close(&w, &keeper);

    let root = root_of(&w);
    let count = bid_count_of(&w);
    let requested: std::vec::Vec<u32> = (0..count)
        .map(|i| bid_record_of(&w, i).requested_quantity)
        .collect();

    let frozen = |w: &setup::World, after: &str| {
        assert_eq!(root_of(w), root, "`{after}` changed the root");
        assert_eq!(bid_count_of(w), count, "`{after}` changed the bid_count");
        for (i, quantity) in requested.iter().enumerate() {
            assert_eq!(
                bid_record_of(w, i as u32).requested_quantity,
                *quantity,
                "`{after}` changed the requested_quantity of bid {i}"
            );
        }
    };

    assert_eq!(
        close_err(&w, &Address::generate(&w.e)),
        AuctionError::InvalidState
    );
    frozen(&w, "repeated close_market");

    assert_eq!(
        super::bidding::submit_err(
            &w,
            &bidders.get(0).unwrap(),
            &super::bidding::a_bid(&w, 1, 9)
        ),
        AuctionError::InvalidState
    );
    frozen(&w, "late submit_bid");

    let novato = Address::generate(&w.e);
    assert_eq!(
        super::bidding::register_err(&w, &novato),
        AuctionError::InvalidState
    );
    frozen(&w, "late register_participant");

    assert_eq!(cancel_err(&w), AuctionError::InvalidState);
    frozen(&w, "cancel_market");

    assert_eq!(
        finalize_err(
            &w,
            &Address::generate(&w.e),
            &quantities(&w, &[1, 1]),
            &a_finalize_proof(&w)
        ),
        AuctionError::InvalidAllocationLength
    );
    frozen(&w, "finalize with wrong length");

    assert_eq!(market_state(&w), MarketStatus::Closed);
}

#[test]
fn close_reimburses_caller_once() {
    let (w, _) = open_with(1, 1);
    at_ledger(&w, close_ledger(&w));

    assert_eq!(fee_reserve_of(&w), MIN_FEE_RESERVE);

    let keeper = Address::generate(&w.e);
    close(&w, &keeper);

    assert_eq!(fee_balance(&w, &keeper), REIMBURSEMENT_PER_CALL);
    assert_eq!(fee_reserve_of(&w), MIN_FEE_RESERVE - REIMBURSEMENT_PER_CALL);
    assert_eq!(
        fee_balance(&w, &w.auction),
        MIN_FEE_RESERVE - REIMBURSEMENT_PER_CALL
    );
    assert_eq!(
        fee_balance(&w, &w.seller),
        0,
        "the seller's reserve only returns when the market ends"
    );
}

#[test]
fn second_close_fails_and_pays_nothing() {
    let (w, _) = open_with(1, 1);
    at_ledger(&w, close_ledger(&w));

    let keeper = Address::generate(&w.e);
    close(&w, &keeper);
    let pago = fee_balance(&w, &keeper);
    let reserve = fee_reserve_of(&w);

    let outro = Address::generate(&w.e);
    assert_eq!(close_err(&w, &outro), AuctionError::InvalidState);

    assert_eq!(fee_balance(&w, &outro), 0);
    assert_eq!(fee_balance(&w, &keeper), pago);
    assert_eq!(fee_reserve_of(&w), reserve);
    assert_eq!(market_state(&w), MarketStatus::Closed);
}

#[test]
fn market_closed_event() {
    let (w, _) = open_with(2, 2);
    at_ledger(&w, close_ledger(&w));
    close(&w, &Address::generate(&w.e));

    let emitted = w.e.events().all().filter_by_contract(&w.auction);

    let mut data: Map<Symbol, Val> = Map::new(&w.e);
    data.set(Symbol::new(&w.e, "bid_count"), 2u32.into_val(&w.e));
    data.set(
        Symbol::new(&w.e, "commitments_root"),
        root_of(&w).unwrap().into_val(&w.e),
    );
    data.set(
        Symbol::new(&w.e, "finalize_by_ledger"),
        finalize_by_of(&w).unwrap().into_val(&w.e),
    );

    let expected = vec![
        &w.e,
        (
            w.auction.clone(),
            vec![
                &w.e,
                Symbol::new(&w.e, "market_closed").into_val(&w.e),
                config_of(&w).market_id.into_val(&w.e),
            ],
            data.into_val(&w.e),
        ),
    ];

    assert_eq!(emitted, expected);
}

pub(super) fn quantities(w: &setup::World, values: &[u32]) -> Vec<u32> {
    let mut out = Vec::new(&w.e);
    for value in values {
        out.push_back(*value);
    }
    out
}

pub(super) fn a_finalize_proof(w: &setup::World) -> Bytes {
    Bytes::from_array(&w.e, &[0xF1; 8])
}

pub(super) fn finalize(w: &setup::World, caller: &Address, filled: &Vec<u32>, proof: &Bytes) {
    let args = vec![
        &w.e,
        caller.into_val(&w.e),
        filled.into_val(&w.e),
        proof.into_val(&w.e),
    ];
    w.e.invoke_contract::<()>(&w.auction, &Symbol::new(&w.e, "finalize"), args);
}

#[allow(clippy::type_complexity)]
fn call_finalize(
    w: &setup::World,
    caller: &Address,
    filled: &Vec<u32>,
    proof: &Bytes,
) -> Result<(), Result<AuctionError, soroban_sdk::InvokeError>> {
    let args = vec![
        &w.e,
        caller.into_val(&w.e),
        filled.into_val(&w.e),
        proof.into_val(&w.e),
    ];
    match w.e.try_invoke_contract::<(), AuctionError>(
        &w.auction,
        &Symbol::new(&w.e, "finalize"),
        args,
    ) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(err) => Err(err),
    }
}

fn finalize_err(
    w: &setup::World,
    caller: &Address,
    filled: &Vec<u32>,
    proof: &Bytes,
) -> AuctionError {
    match call_finalize(w, caller, filled, proof) {
        Ok(()) => panic!("finalize passed when it should have failed"),
        Err(Ok(err)) => err,
        Err(Err(err)) => panic!("the call did not reach the contract: {err:?}"),
    }
}

pub(super) fn allocation_of(w: &setup::World) -> Vec<u32> {
    super::invoke::<Vec<u32>>(&w.e, &w.auction, "get_allocation")
}

pub(super) fn open_bids_of(w: &setup::World) -> Option<u32> {
    w.e.as_contract(&w.auction, || {
        w.e.storage().instance().get(&DataKey::OpenBids)
    })
}

fn set_allocation_accept(w: &setup::World, accept: bool) {
    let verifier = config_of(w).platform.allocation_verifier;
    let args = vec![&w.e, accept.into_val(&w.e)];
    w.e.invoke_contract::<()>(&verifier, &Symbol::new(&w.e, "set_accept"), args);
}

fn allocation_inputs(w: &setup::World) -> Bytes {
    let verifier = config_of(w).platform.allocation_verifier;
    w.e.invoke_contract(&verifier, &Symbol::new(&w.e, "last_inputs"), vec![&w.e])
}

fn allocation_proof(w: &setup::World) -> Bytes {
    let verifier = config_of(w).platform.allocation_verifier;
    w.e.invoke_contract(&verifier, &Symbol::new(&w.e, "last_proof"), vec![&w.e])
}

pub(super) fn closed_with_bidders(requested: &[u32]) -> (setup::World, Vec<Address>) {
    let w = funded_world();
    open(&w);

    let mut bidders = Vec::new(&w.e);
    for (i, quantity) in requested.iter().enumerate() {
        let bidder = Address::generate(&w.e);
        super::bidding::register(&w, &bidder);
        super::bidding::submit(
            &w,
            &bidder,
            &super::bidding::a_bid(&w, *quantity, (i + 1) as u8),
        );
        bidders.push_back(bidder);
    }

    at_ledger(&w, close_ledger(&w));
    close(&w, &Address::generate(&w.e));
    (w, bidders)
}

fn closed_with(requested: &[u32]) -> setup::World {
    closed_with_bidders(requested).0
}

pub(super) fn finalized_with(requested: &[u32], filled: &[u32]) -> (setup::World, Vec<Address>) {
    let (w, bidders) = closed_with_bidders(requested);
    let allocation = quantities(&w, filled);
    finalize(
        &w,
        &Address::generate(&w.e),
        &allocation,
        &a_finalize_proof(&w),
    );
    (w, bidders)
}

pub(super) fn cancelled_with_bidders(requested: &[u32]) -> (setup::World, Vec<Address>) {
    let (w, bidders) = closed_with_bidders(requested);
    at_timeout(&w);
    cancel_expired(&w, &Address::generate(&w.e));
    (w, bidders)
}

#[test]
fn finalize_stores_allocation_per_bid() {
    let w = closed_with(&[4, 4, 2]);
    let filled = quantities(&w, &[4, 0, 0]);

    assert_eq!(
        allocation_of(&w).len(),
        0,
        "before `Finalized` there is no allocation at all"
    );

    finalize(&w, &Address::generate(&w.e), &filled, &a_finalize_proof(&w));

    assert_eq!(market_state(&w), MarketStatus::Finalized);
    assert_eq!(allocation_of(&w), filled);
    for (i, quantity) in [4u32, 0, 0].iter().enumerate() {
        let record = bid_record_of(&w, i as u32);
        assert_eq!(record.filled_quantity, *quantity, "bid {i} is wrong");
        assert_eq!(
            record.status,
            BidStatus::Pending,
            "`finalize` does not settle: `settle` is what settles the bid (5.x)"
        );
    }
    assert_eq!(
        open_bids_of(&w),
        Some(3),
        "the 3 bids remain open for settle"
    );
}

#[test]
fn finalize_returns_unsold_quotas_to_seller() {
    let w = closed_with(&[4, 4, 2]);
    let seller_before = quota_balance(&w, &w.seller);

    finalize(
        &w,
        &Address::generate(&w.e),
        &quantities(&w, &[4, 0, 0]),
        &a_finalize_proof(&w),
    );

    assert_eq!(quota_balance(&w, &w.seller), seller_before + 6 * QUOTA_UNIT);
    assert_eq!(quota_balance(&w, &w.auction), escrow(&w) - 6 * QUOTA_UNIT);
}

#[test]
fn fully_sold_market_returns_nothing() {
    let w = closed_with(&[4, 4, 2]);
    let seller_before = quota_balance(&w, &w.seller);

    finalize(
        &w,
        &Address::generate(&w.e),
        &quantities(&w, &[4, 4, 2]),
        &a_finalize_proof(&w),
    );

    assert_eq!(quota_balance(&w, &w.seller), seller_before);
    assert_eq!(
        quota_balance(&w, &w.auction),
        escrow(&w),
        "the 10 sold quotas stay in the contract until `settle`"
    );
    assert_eq!(allocation_of(&w), quantities(&w, &[4, 4, 2]));
}

#[test]
fn anyone_with_valid_proof_can_finalize() {
    let w = closed_with(&[4, 4, 2]);
    let stranger = Address::generate(&w.e);
    assert_ne!(stranger, w.seller);

    finalize(
        &w,
        &stranger,
        &quantities(&w, &[4, 0, 0]),
        &a_finalize_proof(&w),
    );

    assert_eq!(market_state(&w), MarketStatus::Finalized);
    assert_eq!(allocation_of(&w), quantities(&w, &[4, 0, 0]));

    let w = closed_with(&[4, 4, 2]);
    let filled = quantities(&w, &[4, 0, 0]);
    let proof = a_finalize_proof(&w);
    let keeper = Address::generate(&w.e);
    let impostor = Address::generate(&w.e);
    w.e.mock_auths(&[MockAuth {
        address: &impostor,
        invoke: &MockAuthInvoke {
            contract: &w.auction,
            fn_name: "finalize",
            args: vec![
                &w.e,
                keeper.into_val(&w.e),
                filled.into_val(&w.e),
                proof.into_val(&w.e),
            ],
            sub_invokes: &[],
        },
    }]);

    assert!(
        call_finalize(&w, &keeper, &filled, &proof).is_err(),
        "the reimbursement cannot go to an address that did not sign"
    );
    assert_eq!(market_state(&w), MarketStatus::Closed);

    w.e.mock_all_auths();
    finalize(&w, &keeper, &filled, &proof);
    assert_eq!(market_state(&w), MarketStatus::Finalized);
}

fn expected_allocation_inputs(w: &setup::World, filled: &[u32]) -> Bytes {
    let config = config_of(w);
    let count = bid_count_of(w);
    let hash = config_hash_of(w)
        .expect("the market should be open")
        .to_array();

    let mut lo = [0u8; 32];
    lo[16..32].copy_from_slice(&hash[16..32]);
    let mut hi = [0u8; 32];
    hi[16..32].copy_from_slice(&hash[0..16]);

    let mut out = Bytes::new(&w.e);
    out.append(&Bytes::from_array(&w.e, &root_of(w).unwrap().to_array()));

    for i in 0..MAX_BIDS {
        let requested = if i < count {
            bid_record_of(w, i).requested_quantity
        } else {
            0
        };
        out.append(&u64_field(w, requested as u64));
    }

    for i in 0..MAX_BIDS {
        let value = if i < count { filled[i as usize] } else { 0 };
        out.append(&u64_field(w, value as u64));
    }

    out.append(&u32_field(w, count));
    out.append(&u64_field(w, config.params.total_quotas as u64));
    out.append(&u64_field(w, config.market_id));
    out.append(&u64_field(w, AUCTION_RULE as u64));
    out.append(&Bytes::from_array(&w.e, &lo));
    out.append(&Bytes::from_array(&w.e, &hi));
    out
}

#[test]
fn allocation_inputs_match_circuit_order() {
    let w = closed_with(&[4, 4, 2]);
    let filled = quantities(&w, &[4, 0, 0]);
    finalize(&w, &Address::generate(&w.e), &filled, &a_finalize_proof(&w));

    let sent = allocation_inputs(&w);
    assert_eq!(sent.len(), 736, "23 fields of 32 bytes");
    assert_eq!(sent, expected_allocation_inputs(&w, &[4, 0, 0]));

    assert_eq!(&sent.slice(128..288), &Bytes::from_array(&w.e, &[0u8; 160]));
    assert_eq!(&sent.slice(384..544), &Bytes::from_array(&w.e, &[0u8; 160]));

    assert_eq!(
        &sent.slice(0..32),
        &Bytes::from_array(&w.e, &root_of(&w).unwrap().to_array())
    );
    assert_eq!(&sent.slice(32..64), &u64_field(&w, 4));
    assert_eq!(&sent.slice(288..320), &u64_field(&w, 4));
    assert_eq!(&sent.slice(544..576), &u32_field(&w, 3));
    assert_eq!(
        &sent.slice(608..640),
        &u64_field(&w, config_of(&w).market_id)
    );
    assert_eq!(&sent.slice(640..672), &u64_field(&w, AUCTION_RULE as u64));

    assert_eq!(allocation_proof(&w), a_finalize_proof(&w));
}

#[test]
fn wrong_length_fails() {
    let w = closed_with(&[4, 4, 2]);
    let keeper = Address::generate(&w.e);
    let proof = a_finalize_proof(&w);

    assert_eq!(
        finalize_err(&w, &keeper, &quantities(&w, &[4, 0]), &proof),
        AuctionError::InvalidAllocationLength,
        "3 bids need 3 positions"
    );
    assert_eq!(
        finalize_err(&w, &keeper, &quantities(&w, &[4, 0, 0, 0]), &proof),
        AuctionError::InvalidAllocationLength,
        "an extra position would be a bid that does not exist"
    );

    assert_eq!(market_state(&w), MarketStatus::Closed);
}

#[test]
fn fill_exceeds_request_fails() {
    let w = closed_with(&[4, 4, 2]);
    set_allocation_accept(&w, false);

    assert_eq!(
        finalize_err(
            &w,
            &Address::generate(&w.e),
            &quantities(&w, &[4, 5, 0]),
            &a_finalize_proof(&w)
        ),
        AuctionError::FillExceedsRequest,
        "the second bid requested 4 and the allocation says 5"
    );
    assert_eq!(market_state(&w), MarketStatus::Closed);
}

#[test]
fn overfilled_sum_fails_before_the_proof() {
    let w = closed_with(&[5, 5, 5]);
    set_allocation_accept(&w, false);

    assert_eq!(
        finalize_err(
            &w,
            &Address::generate(&w.e),
            &quantities(&w, &[5, 5, 5]),
            &a_finalize_proof(&w)
        ),
        AuctionError::FillExceedsRequest,
        "15 quotas allocated for an offering of 10"
    );
    assert_eq!(market_state(&w), MarketStatus::Closed);
}

#[test]
fn invalid_proof_fails() {
    let w = closed_with(&[4, 4, 2]);
    set_allocation_accept(&w, false);

    let keeper = Address::generate(&w.e);
    let filled = quantities(&w, &[4, 0, 0]);
    let proof = a_finalize_proof(&w);

    assert_eq!(
        finalize_err(&w, &keeper, &filled, &proof),
        AuctionError::InvalidAllocationProof
    );

    set_allocation_accept(&w, true);
    finalize(&w, &keeper, &filled, &proof);
    assert_eq!(market_state(&w), MarketStatus::Finalized);
}

#[test]
fn finalize_after_deadline_fails_too_late() {
    let w = closed_with(&[4, 4, 2]);
    let keeper = Address::generate(&w.e);
    let filled = quantities(&w, &[4, 0, 0]);
    let proof = a_finalize_proof(&w);
    let deadline = finalize_by_of(&w).unwrap();

    at_ledger(&w, deadline + 1);
    assert_eq!(
        finalize_err(&w, &keeper, &filled, &proof),
        AuctionError::TooLate
    );
    assert_eq!(market_state(&w), MarketStatus::Closed);

    at_ledger(&w, deadline);
    finalize(&w, &keeper, &filled, &proof);
    assert_eq!(market_state(&w), MarketStatus::Finalized);
}

#[test]
fn second_finalize_fails() {
    let w = closed_with(&[4, 4, 2]);
    let filled = quantities(&w, &[4, 0, 0]);
    let proof = a_finalize_proof(&w);

    finalize(&w, &Address::generate(&w.e), &filled, &proof);
    let reserve = fee_reserve_of(&w);

    let outro = Address::generate(&w.e);
    assert_eq!(
        finalize_err(&w, &outro, &quantities(&w, &[0, 4, 2]), &proof),
        AuctionError::InvalidState
    );

    assert_eq!(fee_balance(&w, &outro), 0);
    assert_eq!(fee_reserve_of(&w), reserve);
    assert_eq!(market_state(&w), MarketStatus::Finalized);
    assert_eq!(
        allocation_of(&w),
        filled,
        "the second call could not have rewritten the allocation"
    );
}

#[test]
fn failed_finalize_changes_nothing() {
    let w = closed_with(&[4, 4, 2]);
    let keeper = Address::generate(&w.e);
    let proof = a_finalize_proof(&w);

    let seller_before = quota_balance(&w, &w.seller);
    let reserve = fee_reserve_of(&w);
    let root = root_of(&w);

    let frozen = |w: &setup::World, after: &str| {
        assert_eq!(
            market_state(w),
            MarketStatus::Closed,
            "`{after}` changed the state"
        );
        assert_eq!(allocation_of(w).len(), 0, "`{after}` wrote an allocation");
        assert_eq!(
            open_bids_of(w),
            None,
            "`{after}` wrote `OpenBids` before the proof passed"
        );
        assert_eq!(root_of(w), root, "`{after}` changed the root");
        for i in 0..3 {
            assert_eq!(
                bid_record_of(w, i).filled_quantity,
                0,
                "`{after}` filled bid {i}"
            );
        }
        assert_eq!(
            quota_balance(w, &w.seller),
            seller_before,
            "`{after}` moved a quota from the seller"
        );
        assert_eq!(
            quota_balance(w, &w.auction),
            escrow(w),
            "`{after}` took a quota out of escrow"
        );
        assert_eq!(fee_reserve_of(w), reserve, "`{after}` spent reserve");
        assert_eq!(
            fee_balance(w, &keeper),
            0,
            "the rejected call pays no reimbursement (D-04)"
        );
    };

    assert_eq!(
        finalize_err(&w, &keeper, &quantities(&w, &[4, 0]), &proof),
        AuctionError::InvalidAllocationLength
    );
    frozen(&w, "finalize with wrong length");

    assert_eq!(
        finalize_err(&w, &keeper, &quantities(&w, &[5, 0, 0]), &proof),
        AuctionError::FillExceedsRequest
    );
    frozen(&w, "finalize with the request exceeded");

    set_allocation_accept(&w, false);
    assert_eq!(
        finalize_err(&w, &keeper, &quantities(&w, &[4, 0, 0]), &proof),
        AuctionError::InvalidAllocationProof
    );
    frozen(&w, "finalize with a rejected proof");

    set_allocation_accept(&w, true);
    finalize(&w, &keeper, &quantities(&w, &[4, 0, 0]), &proof);
    assert_eq!(market_state(&w), MarketStatus::Finalized);
}

#[test]
fn finalize_reimburses_caller() {
    let w = closed_with(&[4, 4, 2]);
    let reserve = fee_reserve_of(&w);

    let keeper = Address::generate(&w.e);
    finalize(
        &w,
        &keeper,
        &quantities(&w, &[4, 0, 0]),
        &a_finalize_proof(&w),
    );

    assert_eq!(fee_balance(&w, &keeper), REIMBURSEMENT_PER_CALL);
    assert_eq!(fee_reserve_of(&w), reserve - REIMBURSEMENT_PER_CALL);
    assert_eq!(
        fee_balance(&w, &w.auction),
        reserve - REIMBURSEMENT_PER_CALL
    );
    assert_eq!(
        fee_balance(&w, &w.seller),
        0,
        "the seller's reserve only returns when the market ends (5.x)"
    );
}

#[test]
fn finalized_event_has_quantities_no_price() {
    let w = closed_with(&[4, 4, 2]);
    let filled = quantities(&w, &[4, 0, 0]);
    finalize(&w, &Address::generate(&w.e), &filled, &a_finalize_proof(&w));

    let emitted = w.e.events().all().filter_by_contract(&w.auction);

    let mut data: Map<Symbol, Val> = Map::new(&w.e);
    data.set(
        Symbol::new(&w.e, "filled_quantities"),
        filled.into_val(&w.e),
    );
    data.set(Symbol::new(&w.e, "unsold"), 6u32.into_val(&w.e));

    let expected = vec![
        &w.e,
        (
            w.auction.clone(),
            vec![
                &w.e,
                Symbol::new(&w.e, "market_finalized").into_val(&w.e),
                config_of(&w).market_id.into_val(&w.e),
            ],
            data.into_val(&w.e),
        ),
    ];

    assert_eq!(emitted, expected);
}

pub(super) fn cancel_expired(w: &setup::World, caller: &Address) {
    let args = vec![&w.e, caller.into_val(&w.e)];
    w.e.invoke_contract::<()>(&w.auction, &Symbol::new(&w.e, "cancel_expired"), args);
}

#[allow(clippy::type_complexity)]
fn call_cancel_expired(
    w: &setup::World,
    caller: &Address,
) -> Result<(), Result<AuctionError, soroban_sdk::InvokeError>> {
    let args = vec![&w.e, caller.into_val(&w.e)];
    match w.e.try_invoke_contract::<(), AuctionError>(
        &w.auction,
        &Symbol::new(&w.e, "cancel_expired"),
        args,
    ) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(err) => Err(err),
    }
}

fn cancel_expired_err(w: &setup::World, caller: &Address) -> AuctionError {
    match call_cancel_expired(w, caller) {
        Ok(()) => panic!("cancel_expired passed when it should have failed"),
        Err(Ok(err)) => err,
        Err(Err(err)) => panic!("the call did not reach the contract: {err:?}"),
    }
}

pub(super) fn at_timeout(w: &setup::World) {
    at_ledger(
        w,
        finalize_by_of(w).expect("a closed market always has a deadline") + 1,
    );
}

#[test]
fn cancel_expired_before_deadline_fails_too_early() {
    let w = closed_with(&[4, 4, 2]);
    let keeper = Address::generate(&w.e);

    at_ledger(&w, finalize_by_of(&w).unwrap());
    assert_eq!(
        cancel_expired_err(&w, &keeper),
        AuctionError::TooEarly,
        "on the last `finalize` ledger, the market still belongs to it"
    );

    assert_eq!(market_state(&w), MarketStatus::Closed);
    assert_eq!(fee_balance(&w, &keeper), 0, "the failed call pays nothing");
    assert_eq!(
        quota_balance(&w, &w.auction),
        escrow(&w),
        "the quotas could not have left"
    );

    at_timeout(&w);
    cancel_expired(&w, &keeper);
    assert_eq!(market_state(&w), MarketStatus::Cancelled);
}

#[test]
fn cancel_expired_after_deadline_returns_all_quotas() {
    let w = closed_with(&[4, 4, 2]);
    let seller_before = quota_balance(&w, &w.seller);

    at_timeout(&w);
    cancel_expired(&w, &Address::generate(&w.e));

    assert_eq!(
        quota_balance(&w, &w.seller),
        seller_before + escrow(&w),
        "all 10 quotas return"
    );
    assert_eq!(quota_balance(&w, &w.auction), 0);
    assert_eq!(market_state(&w), MarketStatus::Cancelled);
}

#[test]
fn cancel_expired_leaves_bids_pending_for_refund() {
    let w = closed_with(&[4, 4, 2]);
    let requested = [4u32, 4, 2];

    at_timeout(&w);
    cancel_expired(&w, &Address::generate(&w.e));

    for (i, want) in requested.iter().enumerate() {
        let record = bid_record_of(&w, i as u32);
        assert_eq!(
            record.status,
            BidStatus::Pending,
            "bid {i} did not stay Pending"
        );
        assert_eq!(
            record.filled_quantity, 0,
            "bid {i} received quotas in a cancellation"
        );
        assert_eq!(
            record.requested_quantity, *want,
            "the request of bid {i} changed"
        );
    }
    assert!(
        allocation_of(&w).is_empty(),
        "a cancelled market has no allocation"
    );

    assert_eq!(
        open_bids_of(&w),
        Some(3),
        "the three bids remain open for reimbursement"
    );
}

#[test]
fn anyone_can_cancel_expired() {
    let w = closed_with(&[4, 4, 2]);
    let stranger = Address::generate(&w.e);
    assert_ne!(stranger, w.seller);

    at_timeout(&w);
    cancel_expired(&w, &stranger);
    assert_eq!(market_state(&w), MarketStatus::Cancelled);

    let w = closed_with(&[4, 4, 2]);
    let impostor = Address::generate(&w.e);
    at_timeout(&w);

    w.e.set_auths(&[]);
    let invoke = MockAuthInvoke {
        contract: &w.auction,
        fn_name: "cancel_expired",
        args: vec![&w.e, impostor.clone().into_val(&w.e)],
        sub_invokes: &[],
    };
    w.e.mock_auths(&[MockAuth {
        address: &w.seller,
        invoke: &invoke,
    }]);

    assert!(
        call_cancel_expired(&w, &impostor).is_err(),
        "the impostor cancelled without signing"
    );
    assert_eq!(market_state(&w), MarketStatus::Closed);

    w.e.mock_all_auths();
    cancel_expired(&w, &impostor);
    assert_eq!(market_state(&w), MarketStatus::Cancelled);
}

#[test]
fn cancel_expired_reimburses_caller() {
    let w = closed_with(&[4, 4, 2]);
    let reserve = fee_reserve_of(&w);

    let keeper = Address::generate(&w.e);
    at_timeout(&w);
    cancel_expired(&w, &keeper);

    assert_eq!(fee_balance(&w, &keeper), REIMBURSEMENT_PER_CALL);
    assert_eq!(fee_reserve_of(&w), reserve - REIMBURSEMENT_PER_CALL);
    assert_eq!(
        fee_balance(&w, &w.seller),
        0,
        "the seller's reserve only returns on the last `settle` of a cancelled market (5.4)"
    );
}

#[test]
fn finalize_after_cancel_expired_fails() {
    let w = closed_with(&[4, 4, 2]);
    let filled = quantities(&w, &[4, 0, 0]);
    let proof = a_finalize_proof(&w);

    at_timeout(&w);
    cancel_expired(&w, &Address::generate(&w.e));
    assert_eq!(market_state(&w), MarketStatus::Cancelled);

    let tarde = Address::generate(&w.e);
    assert_eq!(
        finalize_err(&w, &tarde, &filled, &proof),
        AuctionError::InvalidState
    );

    assert_eq!(fee_balance(&w, &tarde), 0);
    assert_eq!(market_state(&w), MarketStatus::Cancelled);
    assert!(
        allocation_of(&w).is_empty(),
        "the rejected allocation could not have been recorded"
    );
}
