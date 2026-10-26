#![allow(dead_code)]

use shared::types::{
    BidEnvelope, BidRecord, BidStatus, BidSubmission, MarketParams, PlatformConfig, SettleOutcome,
    AUCTION_RULE, FEE_BPS, FINALIZATION_GRACE_LEDGERS, MAX_BIDS, MIN_FEE_RESERVE, QUOTA_UNIT,
};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::xdr::{FromXdr, ToXdr};
use soroban_sdk::{
    contract, contractimpl, contracttype, vec, Address, Bytes, BytesN, Env, IntoVal, Symbol, Vec,
};

use auction::external::{SpenderDelegation, SpenderTransferData, SpenderTransferPayload};
use auction::types::{AuctionError, DataKey, MarketStatus};
use auction::Auction;

const ULTRAHONK_VERIFIER: &[u8] = include_bytes!("../../../../wasm/ultrahonk_verifier.wasm");

pub const START_LEDGER: u32 = 1_000_000;

pub const MARKET_ID: u64 = 42;

pub const BIDDER_ID: u32 = 7;

pub const MIN_PRICE_PER_QUOTA: u64 = 500;

pub const REQUESTED_QUANTITY: u32 = 200;

pub const TOTAL_QUOTAS: u32 = 1_000;

const REGISTER_DATA: [u8; 3] = [1, 2, 3];

pub const CASE: &str = "valid_ana";

pub const CLOSE_LEDGER: u32 = START_LEDGER + 1_000;

pub struct World {
    pub e: Env,
    pub auction: Address,
    pub seller: Address,
    pub fee_asset: Address,
    pub quota_asset: Address,
    pub collateral_token: Address,

    pub bidder: Address,

    pub other: Address,
}

pub fn new_world() -> World {
    build(START_LEDGER + 1_000)
}

pub fn new_world_with_close_ledger(close_ledger: u32) -> World {
    build(close_ledger)
}

fn build(close_ledger: u32) -> World {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().with_mut(|li| li.sequence_number = START_LEDGER);

    let admin = Address::generate(&e);
    let seller = Address::generate(&e);
    let bidder = Address::generate(&e);
    let other = Address::generate(&e);

    let token = e.register(FakeConfidentialToken, ());
    let vk = read_repo(
        "../../artifacts/vks/bid_validity.vk.bin",
        "run ./scripts/circuits.sh (step 3.1)",
    );
    let bid_verifier = e.register(ULTRAHONK_VERIFIER, (Bytes::from_slice(&e, &vk),));
    let fee_asset = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let quota_asset = e.register_stellar_asset_contract_v2(admin).address();

    let platform = PlatformConfig {
        collateral_token: token.clone(),
        fee_asset: fee_asset.clone(),
        bid_verifier,

        allocation_verifier: Address::generate(&e),
        settlement_verifier: Address::generate(&e),
        fee_wallet: Address::generate(&e),
        auditor_id: 7,
        finalization_grace_ledgers: shared::types::FINALIZATION_GRACE_LEDGERS,
    };

    let params = MarketParams {
        quota_asset: quota_asset.clone(),
        total_quotas: TOTAL_QUOTAS,
        min_price_per_quota: MIN_PRICE_PER_QUOTA,
        close_ledger,

        eligibility_policy: None,
        fee_reserve: MIN_FEE_RESERVE,
    };

    let auction = e.register(
        Auction,
        (
            MARKET_ID,
            seller.clone(),
            params,
            platform,
            Bytes::from_array(&e, &REGISTER_DATA),
        ),
    );

    StellarAssetClient::new(&e, &fee_asset).mint(&seller, &MIN_FEE_RESERVE);
    TokenClient::new(&e, &fee_asset).transfer(&seller, &auction, &MIN_FEE_RESERVE);

    StellarAssetClient::new(&e, &quota_asset).mint(&seller, &(TOTAL_QUOTAS as i128 * QUOTA_UNIT));
    e.invoke_contract::<()>(&auction, &Symbol::new(&e, "open_market"), Vec::new(&e));

    for _ in 0..BIDDER_ID {
        let dummy = Address::generate(&e);
        register_participant(&e, &auction, &dummy);
    }
    register_participant(&e, &auction, &bidder);
    register_participant(&e, &auction, &other);

    World {
        e,
        auction,
        seller,
        fee_asset,
        quota_asset,
        collateral_token: token,
        bidder,
        other,
    }
}

fn register_participant(e: &Env, auction: &Address, participant: &Address) -> u32 {
    e.invoke_contract::<u32>(
        auction,
        &Symbol::new(e, "register_participant"),
        vec![e, participant.into_val(e)],
    )
}

pub fn submit(
    w: &World,
    bidder: &Address,
    bid: &BidSubmission,
) -> Result<u32, Result<AuctionError, soroban_sdk::InvokeError>> {
    submit_to(&w.e, &w.auction, bidder, bid)
}

pub fn submit_to(
    e: &Env,
    auction: &Address,
    bidder: &Address,
    bid: &BidSubmission,
) -> Result<u32, Result<AuctionError, soroban_sdk::InvokeError>> {
    let args = vec![e, bidder.into_val(e), bid.into_val(e)];
    match e.try_invoke_contract::<u32, AuctionError>(auction, &Symbol::new(e, "submit_bid"), args) {
        Ok(Ok(index)) => Ok(index),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(err) => Err(err),
    }
}

pub fn submit_err(w: &World, bidder: &Address, bid: &BidSubmission) -> AuctionError {
    match submit(w, bidder, bid) {
        Ok(index) => panic!("submit_bid passed (index {index}) when it should have failed"),
        Err(Ok(err)) => err,
        Err(Err(err)) => panic!("the call did not reach the contract: {err:?}"),
    }
}

pub fn set_delegation(w: &World, account: &Address, allowance_commitment: &BytesN<64>) {
    set_delegation_to(
        &w.e,
        &w.collateral_token,
        &w.auction,
        account,
        allowance_commitment,
    );
}

pub fn set_delegation_to(
    e: &Env,
    token: &Address,
    auction: &Address,
    account: &Address,
    allowance_commitment: &BytesN<64>,
) {
    let args = vec![
        e,
        account.into_val(e),
        auction.into_val(e),
        allowance_commitment.into_val(e),
    ];
    e.invoke_contract::<()>(token, &Symbol::new(e, "set_delegation"), args);
}

pub fn config_hash(w: &World) -> BytesN<32> {
    w.e.invoke_contract(
        &w.auction,
        &Symbol::new(&w.e, "get_config_hash"),
        Vec::new(&w.e),
    )
}

fn read_repo(rel: &str, hint: &str) -> std::vec::Vec<u8> {
    let path = std::format!("{}/{}", env!("CARGO_MANIFEST_DIR"), rel);
    std::fs::read(&path).unwrap_or_else(|err| {
        panic!("could not read {path}: {err}\n  -> {hint}");
    })
}

pub fn bid_proof(case: &str) -> std::vec::Vec<u8> {
    read_repo(
        &std::format!("../../artifacts/fixtures/bid_validity/{case}/proof"),
        "run ./scripts/fixtures.sh",
    )
}

pub fn bid_public_inputs(case: &str) -> std::vec::Vec<u8> {
    read_repo(
        &std::format!("../../artifacts/fixtures/bid_validity/{case}/public_inputs"),
        "run ./scripts/fixtures.sh",
    )
}

pub fn proof() -> std::vec::Vec<u8> {
    bid_proof(CASE)
}

pub fn public_inputs() -> std::vec::Vec<u8> {
    bid_public_inputs(CASE)
}

pub struct Context {
    pub market_id: u64,
    pub participant_id: u32,
    pub requested_quantity: u32,
    pub min_price_per_quota: u64,
    pub config_hash: std::string::String,
    pub config_hash_hi: std::string::String,
    pub config_hash_lo: std::string::String,
}

pub fn context() -> Context {
    let raw = read_repo(
        "../../circuits/bid_validity/fixtures/valid_ana/context.json",
        "run cargo test --test fixtures_dump -- --ignored",
    );
    let json: serde_json::Value =
        serde_json::from_slice(&raw).expect("context.json is not valid JSON");
    let text = |name: &str| {
        json.get(name)
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| panic!("context.json does not have the string `{name}`"))
            .to_string()
    };
    let number = |name: &str| {
        json.get(name)
            .and_then(|v| v.as_u64())
            .unwrap_or_else(|| panic!("context.json does not have the number `{name}`"))
    };

    Context {
        market_id: number("market_id"),
        participant_id: number("participant_id") as u32,
        requested_quantity: number("requested_quantity") as u32,
        min_price_per_quota: number("min_price_per_quota"),
        config_hash: text("config_hash"),
        config_hash_hi: text("config_hash_hi"),
        config_hash_lo: text("config_hash_lo"),
    }
}

pub fn collateral_binding(e: &Env) -> BytesN<64> {
    collateral_binding_of(e, CASE)
}

pub fn collateral_binding_of(e: &Env, case: &str) -> BytesN<64> {
    let pi = bid_public_inputs(case);
    let mut raw = [0u8; 64];
    raw.copy_from_slice(&pi[6 * 32..8 * 32]);
    BytesN::from_array(e, &raw)
}

pub fn participant_id(w: &World, participant: &Address) -> u32 {
    w.e.invoke_contract::<u32>(
        &w.auction,
        &Symbol::new(&w.e, "get_participant_id"),
        vec![&w.e, participant.into_val(&w.e)],
    )
}

pub fn bid_count(w: &World) -> u32 {
    w.e.invoke_contract(
        &w.auction,
        &Symbol::new(&w.e, "get_bid_count"),
        Vec::new(&w.e),
    )
}

pub fn has_nullifier(w: &World, nullifier: &BytesN<32>) -> bool {
    w.e.invoke_contract(
        &w.auction,
        &Symbol::new(&w.e, "has_nullifier"),
        vec![&w.e, nullifier.into_val(&w.e)],
    )
}

pub fn hex(bytes: &[u8]) -> std::string::String {
    use std::fmt::Write as _;
    bytes.iter().fold(std::string::String::new(), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}

pub fn hex_bytes(bytes: &Bytes) -> std::string::String {
    let mut raw = std::vec![0u8; bytes.len() as usize];
    bytes.copy_into_slice(&mut raw);
    hex(&raw)
}

pub fn submission(e: &Env, proof: &[u8]) -> BidSubmission {
    submission_of(e, CASE, proof)
}

pub fn submission_of(e: &Env, case: &str, proof: &[u8]) -> BidSubmission {
    let pi = bid_public_inputs(case);
    assert_eq!(
        pi.len(),
        15 * 32,
        "the public inputs of {case} do not have 15 fields"
    );

    let f32 = |i: usize| -> BytesN<32> { BytesN::from_array(e, &array32(&pi[i * 32..])) };
    let f64 = |i: usize| -> BytesN<64> {
        let mut raw = [0u8; 64];
        raw.copy_from_slice(&pi[i * 32..(i + 2) * 32]);
        BytesN::from_array(e, &raw)
    };

    BidSubmission {
        requested_quantity: u32::from_be_bytes(array32(&pi[4 * 32..])[28..32].try_into().unwrap()),
        commitment: f32(0),
        nullifier: f32(1),
        envelope: BidEnvelope {
            r_point: f64(8),
            ct_price: f32(10),
            ct_blinding: f32(11),
            ct_seed: f32(12),
        },
        proof: Bytes::from_slice(e, proof),
    }
}

fn array32(slice: &[u8]) -> [u8; 32] {
    let mut raw = [0u8; 32];
    raw.copy_from_slice(&slice[..32]);
    raw
}

#[contract]
pub struct FakeConfidentialToken;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FakeTokenKey {
    Delegation(Address, Address),

    DelegationRevoked(Address, Address),

    Legs,

    OpenAccount(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegRecord {
    pub from: Address,
    pub to: Address,
    pub c_tx: BytesN<64>,
}

#[contractimpl]
impl FakeConfidentialToken {
    pub fn register(_e: Env, _account: Address, _auditor_id: u32, _data: Bytes) {}

    pub fn set_delegation(
        e: Env,
        account: Address,
        spender: Address,
        allowance_commitment: BytesN<64>,
    ) {
        let mut delegation = live_delegation(&e);
        delegation.allowance_commitment = allowance_commitment;
        store(&e, &account, &spender, delegation);
    }

    pub fn revoke_delegation(e: Env, account: Address, spender: Address) {
        let storage = e.storage().instance();
        storage.set(
            &FakeTokenKey::DelegationRevoked(account.clone(), spender.clone()),
            &(),
        );
        storage.remove(&FakeTokenKey::Delegation(account, spender));
    }

    pub fn is_spender(e: Env, account: Address, spender: Address) -> bool {
        delegation(&e, &account, &spender)
            .is_some_and(|d| e.ledger().sequence() <= d.live_until_ledger)
    }

    pub fn get_spender_delegation(e: Env, account: Address, spender: Address) -> SpenderDelegation {
        delegation(&e, &account, &spender).expect("DelegationNotFound")
    }

    pub fn confidential_transfer_from(
        e: Env,
        spender: Address,
        from: Address,
        to: Address,
        data: Bytes,
    ) {
        spender.require_auth();

        let payload = SpenderTransferData::from_xdr(&e, &data)
            .expect("the real token would reject this data: it does not decode");

        if to != from
            && !e
                .storage()
                .instance()
                .has(&FakeTokenKey::OpenAccount(to.clone()))
        {
            panic!("AccountNotRegistered");
        }

        let key = FakeTokenKey::Legs;
        let mut seen: Vec<LegRecord> = e.storage().instance().get(&key).unwrap_or(Vec::new(&e));
        seen.push_back(LegRecord {
            from,
            to,
            c_tx: payload.payload.c_tx,
        });
        e.storage().instance().set(&key, &seen);
    }

    pub fn open_account(e: Env, account: Address) {
        e.storage()
            .instance()
            .set(&FakeTokenKey::OpenAccount(account), &());
    }

    pub fn legs(e: Env) -> Vec<LegRecord> {
        e.storage()
            .instance()
            .get(&FakeTokenKey::Legs)
            .unwrap_or(Vec::new(&e))
    }
}

fn live_delegation(e: &Env) -> SpenderDelegation {
    SpenderDelegation {
        allowance_commitment: BytesN::from_array(e, &[0; 64]),
        encrypted_allowance: BytesN::from_array(e, &[0; 32]),
        escrowed_dvk: BytesN::from_array(e, &[0; 64]),
        allowance_salt: BytesN::from_array(e, &[0; 32]),
        live_until_ledger: u32::MAX,
    }
}

fn store(e: &Env, account: &Address, spender: &Address, value: SpenderDelegation) {
    let storage = e.storage().instance();
    storage.set(
        &FakeTokenKey::Delegation(account.clone(), spender.clone()),
        &value,
    );
    storage.remove(&FakeTokenKey::DelegationRevoked(
        account.clone(),
        spender.clone(),
    ));
}

fn delegation(e: &Env, account: &Address, spender: &Address) -> Option<SpenderDelegation> {
    let storage = e.storage().instance();
    if storage.has(&FakeTokenKey::DelegationRevoked(
        account.clone(),
        spender.clone(),
    )) {
        return None;
    }

    storage
        .get(&FakeTokenKey::Delegation(account.clone(), spender.clone()))
        .or_else(|| Some(live_delegation(e)))
}

pub const ALLOC_CASES: [&str; 2] = ["poc4_8bids", "undersubscribed"];

pub const BID_CASES: [(&str, &str, u32); 11] = [
    ("poc4_8bids", "poc4_b0", 0),
    ("poc4_8bids", "poc4_b1", 1),
    ("poc4_8bids", "poc4_b2", 2),
    ("poc4_8bids", "poc4_b3", 3),
    ("poc4_8bids", "poc4_b4", 4),
    ("poc4_8bids", "poc4_b5", 5),
    ("poc4_8bids", "poc4_b6", 6),
    ("poc4_8bids", "poc4_b7", 7),
    ("undersubscribed", "under_b0", 0),
    ("undersubscribed", "under_b1", 1),
    ("undersubscribed", "under_b2", 2),
];

pub fn case_prefix(scenario: &str) -> &'static str {
    match scenario {
        "poc4_8bids" => "poc4",
        "undersubscribed" => "under",
        other => panic!("there is no case prefix for scenario `{other}`"),
    }
}

pub fn settle_case_of(scenario: &str, bid: u32, filled: u32) -> std::string::String {
    std::format!("{}_b{bid}_f{filled}", case_prefix(scenario))
}

pub fn bid_case_of(scenario: &str, bid: u32) -> &'static str {
    BID_CASES
        .iter()
        .find(|(name, _, index)| *name == scenario && *index == bid)
        .map(|(_, case, _)| *case)
        .unwrap_or_else(|| panic!("there is no bid_validity fixture for bid {bid} of {scenario}"))
}

pub struct Scenario {
    pub prices: [u64; MAX_BIDS as usize],
    pub blindings: [u64; MAX_BIDS as usize],
    pub nullifier_seeds: [u64; MAX_BIDS as usize],
    pub participant_ids: [u64; MAX_BIDS as usize],
    pub requested: [u32; MAX_BIDS as usize],
    pub filled: [u32; MAX_BIDS as usize],
    pub bid_count: u32,
    pub total_supply: u32,
    pub market_id: u64,
    pub auction_rule: u32,
}

fn toml_entries(
    path: &str,
    hint: &str,
) -> std::vec::Vec<(std::string::String, std::string::String)> {
    let raw = read_repo(path, hint);
    let text = std::string::String::from_utf8(raw).expect("Prover.toml is not UTF-8");

    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| {
            let (key, value) = line
                .split_once('=')
                .unwrap_or_else(|| panic!("line without `=` in {path}: {line}"));
            (key.trim().to_string(), value.trim().to_string())
        })
        .collect()
}

fn scenario(case: &str) -> Scenario {
    let path = std::format!("../../circuits/winner_allocation/fixtures/{case}/Prover.toml");
    let entries = toml_entries(
        &path,
        "the winner_allocation scenario lives in the case's Prover.toml",
    );

    let raw_of = |name: &str| -> std::string::String {
        entries
            .iter()
            .find(|(key, _)| key == name)
            .unwrap_or_else(|| panic!("the Prover.toml of {case} does not have `{name}`"))
            .1
            .clone()
    };
    let scalar = |name: &str| -> u64 { parse_hex(raw_of(name).trim_matches('"')) };
    let array = |name: &str| -> [u64; MAX_BIDS as usize] {
        let raw = raw_of(name);
        let inner = raw
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
            .unwrap_or_else(|| panic!("`{name}` is not an array in the Prover.toml of {case}"));
        let values: std::vec::Vec<u64> = inner
            .split(',')
            .map(|item| parse_hex(item.trim().trim_matches('"')))
            .collect();
        assert_eq!(
            values.len(),
            MAX_BIDS as usize,
            "`{name}` of {case} does not have MAX_BIDS positions"
        );
        let mut out = [0u64; MAX_BIDS as usize];
        out.copy_from_slice(&values);
        out
    };

    let narrow = |name: &str| -> [u32; MAX_BIDS as usize] {
        let wide = array(name);
        let mut out = [0u32; MAX_BIDS as usize];
        for i in 0..MAX_BIDS as usize {
            out[i] = u32::try_from(wide[i])
                .unwrap_or_else(|_| panic!("`{name}[{i}]` of {case} does not fit in u32"));
        }
        out
    };

    Scenario {
        prices: array("prices"),
        blindings: array("blindings"),
        nullifier_seeds: array("nullifier_seeds"),
        participant_ids: array("participant_ids"),
        requested: narrow("requested_quantities"),
        filled: narrow("filled_quantities"),
        bid_count: scalar("bid_count") as u32,
        total_supply: scalar("total_supply") as u32,
        market_id: scalar("market_id"),
        auction_rule: scalar("auction_rule") as u32,
    }
}

fn parse_hex(text: &str) -> u64 {
    let digits = text.strip_prefix("0x").unwrap_or_else(|| {
        panic!("`{text}` is not in hexadecimal: this repository's Prover.toml always is")
    });
    u64::from_str_radix(digits, 16).unwrap_or_else(|err| panic!("`{text}` is not hex: {err}"))
}

pub struct AllocWorld {
    pub e: Env,
    pub auction: Address,
    pub seller: Address,
    pub fee_asset: Address,
    pub quota_asset: Address,
    pub scenario: Scenario,

    pub commitments: Vec<BytesN<32>>,
}

impl AllocWorld {
    pub fn config_hash(&self) -> BytesN<32> {
        self.e
            .invoke_contract::<Option<BytesN<32>>>(
                &self.auction,
                &Symbol::new(&self.e, "get_config_hash"),
                Vec::new(&self.e),
            )
            .expect("the config_hash is written in open_market")
    }

    pub fn state(&self) -> MarketStatus {
        self.e.invoke_contract(
            &self.auction,
            &Symbol::new(&self.e, "get_state"),
            Vec::new(&self.e),
        )
    }

    pub fn root(&self) -> Option<BytesN<32>> {
        self.e.invoke_contract(
            &self.auction,
            &Symbol::new(&self.e, "get_commitments_root"),
            Vec::new(&self.e),
        )
    }

    pub fn allocation(&self) -> Vec<u32> {
        self.e.invoke_contract(
            &self.auction,
            &Symbol::new(&self.e, "get_allocation"),
            Vec::new(&self.e),
        )
    }

    pub fn bid_record(&self, bid_index: u32) -> BidRecord {
        self.e.invoke_contract(
            &self.auction,
            &Symbol::new(&self.e, "get_bid_record"),
            vec![&self.e, bid_index.into_val(&self.e)],
        )
    }

    pub fn filled(&self) -> Vec<u32> {
        quantities(
            &self.e,
            &self.scenario.filled[..self.scenario.bid_count as usize],
        )
    }

    pub fn seller_quotas(&self) -> i128 {
        TokenClient::new(&self.e, &self.quota_asset).balance(&self.seller)
    }
}

struct OpenScenario {
    e: Env,
    auction: Address,
    seller: Address,
    fee_asset: Address,
    quota_asset: Address,
    collateral_token: Address,
    scenario: Scenario,
}

fn open_scenario(case: &str) -> OpenScenario {
    let s = scenario(case);

    assert_eq!(
        s.auction_rule, AUCTION_RULE,
        "the {case} fixture was proved with another allocation rule"
    );

    let e = Env::default();
    e.mock_all_auths();
    e.ledger().with_mut(|li| li.sequence_number = START_LEDGER);

    let admin = Address::generate(&e);
    let seller = Address::generate(&e);

    let token = e.register(FakeConfidentialToken, ());
    let bid_vk = read_repo(
        "../../artifacts/vks/bid_validity.vk.bin",
        "run ./scripts/circuits.sh (step 3.1)",
    );
    let alloc_vk = read_repo(
        "../../artifacts/vks/winner_allocation.vk.bin",
        "run ./scripts/circuits.sh (step 4.2)",
    );
    let bid_verifier = e.register(ULTRAHONK_VERIFIER, (Bytes::from_slice(&e, &bid_vk),));

    let allocation_verifier = e.register(ULTRAHONK_VERIFIER, (Bytes::from_slice(&e, &alloc_vk),));
    let fee_asset = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let quota_asset = e.register_stellar_asset_contract_v2(admin).address();

    let settlement_verifier = Address::generate(&e);
    let fee_wallet = Address::generate(&e);
    let platform = PlatformConfig {
        collateral_token: token.clone(),
        fee_asset: fee_asset.clone(),
        bid_verifier,
        allocation_verifier,
        settlement_verifier: settlement_verifier.clone(),
        fee_wallet: fee_wallet.clone(),
        auditor_id: 7,
        finalization_grace_ledgers: shared::types::FINALIZATION_GRACE_LEDGERS,
    };

    let settlement_vk = read_repo(
        "../../artifacts/vks/settlement_binding.vk.bin",
        "run ./scripts/circuits.sh (step 5.1)",
    );
    e.register_at(
        &settlement_verifier,
        ULTRAHONK_VERIFIER,
        (Bytes::from_slice(&e, &settlement_vk),),
    );
    let params = MarketParams {
        quota_asset: quota_asset.clone(),

        total_quotas: s.total_supply,
        min_price_per_quota: MIN_PRICE_PER_QUOTA,
        close_ledger: CLOSE_LEDGER,
        eligibility_policy: None,
        fee_reserve: MIN_FEE_RESERVE,
    };

    let auction = e.register(
        Auction,
        (
            s.market_id,
            seller.clone(),
            params,
            platform,
            Bytes::from_array(&e, &REGISTER_DATA),
        ),
    );

    for account in [&seller, &fee_wallet] {
        e.invoke_contract::<()>(
            &token,
            &Symbol::new(&e, "open_account"),
            vec![&e, account.into_val(&e)],
        );
    }

    StellarAssetClient::new(&e, &fee_asset).mint(&seller, &MIN_FEE_RESERVE);
    TokenClient::new(&e, &fee_asset).transfer(&seller, &auction, &MIN_FEE_RESERVE);
    StellarAssetClient::new(&e, &quota_asset).mint(&seller, &(s.total_supply as i128 * QUOTA_UNIT));
    e.invoke_contract::<()>(&auction, &Symbol::new(&e, "open_market"), Vec::new(&e));

    OpenScenario {
        e,
        auction,
        seller,
        fee_asset,
        quota_asset,
        collateral_token: token,
        scenario: s,
    }
}

pub fn alloc_world(case: &str) -> AllocWorld {
    let o = open_scenario(case);
    let s = o.scenario;

    let mut commitments = Vec::new(&o.e);
    for i in 0..s.bid_count as usize {
        commitments.push_back(auction::crypto::commitment(
            &o.e,
            s.prices[i],
            s.market_id,
            s.participant_ids[i] as u32,
            s.blindings[i],
            s.nullifier_seeds[i],
        ));
    }

    seed_bids(&o.e, &o.auction, &s, &commitments);

    o.e.ledger()
        .with_mut(|li| li.sequence_number = CLOSE_LEDGER);
    let keeper = Address::generate(&o.e);
    o.e.invoke_contract::<()>(
        &o.auction,
        &Symbol::new(&o.e, "close_market"),
        vec![&o.e, keeper.into_val(&o.e)],
    );

    AllocWorld {
        e: o.e,
        auction: o.auction,
        seller: o.seller,
        fee_asset: o.fee_asset,
        quota_asset: o.quota_asset,
        scenario: s,
        commitments,
    }
}

fn seed_bids(e: &Env, auction: &Address, s: &Scenario, commitments: &Vec<BytesN<32>>) {
    let mut bids = Vec::new(e);
    for i in 0..s.bid_count as usize {
        let bidder = Address::generate(e);
        bids.push_back(BidRecord {
            bidder,
            participant_id: s.participant_ids[i] as u32,
            commitment: commitments.get(i as u32).unwrap(),
            nullifier: BytesN::from_array(e, &[0; 32]),
            requested_quantity: s.requested[i],
            envelope: BidEnvelope {
                r_point: BytesN::from_array(e, &[0; 64]),
                ct_price: BytesN::from_array(e, &[0; 32]),
                ct_blinding: BytesN::from_array(e, &[0; 32]),
                ct_seed: BytesN::from_array(e, &[0; 32]),
            },
            filled_quantity: 0,
            status: BidStatus::Pending,
        });
    }

    e.as_contract(auction, || {
        e.storage().instance().set(&DataKey::Bids, &bids);
    });
}

pub fn alloc_proof(case: &str) -> std::vec::Vec<u8> {
    read_repo(
        &std::format!("../../artifacts/fixtures/winner_allocation/{case}/proof"),
        "run ./scripts/fixtures.sh",
    )
}

pub fn alloc_public_inputs(case: &str) -> std::vec::Vec<u8> {
    read_repo(
        &std::format!("../../artifacts/fixtures/winner_allocation/{case}/public_inputs"),
        "run ./scripts/fixtures.sh",
    )
}

pub struct AllocContext {
    pub market_id: u64,
    pub total_supply: u32,
    pub bid_count: u32,
    pub config_hash: std::string::String,
}

pub fn alloc_context(case: &str) -> AllocContext {
    let raw = read_repo(
        &std::format!("../../circuits/winner_allocation/fixtures/{case}/context.json"),
        "run cargo test --test fixtures_dump -- --ignored",
    );
    let json: serde_json::Value =
        serde_json::from_slice(&raw).expect("context.json is not valid JSON");
    let number = |name: &str| {
        json.get(name).and_then(|v| v.as_u64()).unwrap_or_else(|| {
            panic!("the context.json of {case} does not have the number `{name}`")
        })
    };
    let text = |name: &str| {
        json.get(name)
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| {
                panic!("the context.json of {case} does not have the string `{name}`")
            })
            .to_string()
    };

    AllocContext {
        market_id: number("market_id"),
        total_supply: number("total_supply") as u32,
        bid_count: number("bid_count") as u32,
        config_hash: text("config_hash"),
    }
}

pub fn finalize(
    w: &AllocWorld,
    caller: &Address,
    filled: &Vec<u32>,
    proof: &[u8],
) -> Result<(), Result<AuctionError, soroban_sdk::InvokeError>> {
    finalize_to(&w.e, &w.auction, caller, filled, proof)
}

pub fn finalize_to(
    e: &Env,
    auction: &Address,
    caller: &Address,
    filled: &Vec<u32>,
    proof: &[u8],
) -> Result<(), Result<AuctionError, soroban_sdk::InvokeError>> {
    let args = vec![
        e,
        caller.into_val(e),
        filled.into_val(e),
        Bytes::from_slice(e, proof).into_val(e),
    ];
    match e.try_invoke_contract::<(), AuctionError>(auction, &Symbol::new(e, "finalize"), args) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(err) => Err(err),
    }
}

pub fn quantities(e: &Env, values: &[u32]) -> Vec<u32> {
    let mut out = Vec::new(e);
    for value in values {
        out.push_back(*value);
    }
    out
}

pub const SETTLE_CASES: [&str; 3] = ["partial", "full", "zero"];

pub struct SettleCase {
    pub commitment: [u8; 32],
    pub requested_quantity: u32,
    pub filled_quantity: u32,
    pub fee_bps: u32,
    pub c_seller: [u8; 64],
    pub c_fee: [u8; 64],
    pub c_refund: [u8; 64],

    pub price: u64,
    pub market_id: u64,
    pub participant_id: u32,
    pub blinding: u64,
    pub nullifier_seed: u64,
}

pub fn settle_case(case: &str) -> SettleCase {
    let path = std::format!("../../circuits/settlement_binding/fixtures/{case}/Prover.toml");
    let entries = toml_entries(
        &path,
        "the settlement_binding scenario lives in the case's Prover.toml",
    );

    let raw_of = |name: &str| -> std::string::String {
        entries
            .iter()
            .find(|(key, _)| key == name)
            .unwrap_or_else(|| panic!("the Prover.toml of {case} does not have `{name}`"))
            .1
            .clone()
    };
    let scalar = |name: &str| -> u64 { parse_hex(raw_of(name).trim_matches('"')) };
    let wide = |name: &str| -> u32 {
        u32::try_from(scalar(name))
            .unwrap_or_else(|_| panic!("`{name}` of {case} does not fit in u32"))
    };

    SettleCase {
        commitment: unhex(&raw_of("bid_commitment")),
        requested_quantity: wide("requested_quantity"),
        filled_quantity: wide("filled_quantity"),
        fee_bps: wide("fee_bps"),
        c_seller: point(&raw_of("c_seller_x"), &raw_of("c_seller_y")),
        c_fee: point(&raw_of("c_fee_x"), &raw_of("c_fee_y")),
        c_refund: point(&raw_of("c_refund_x"), &raw_of("c_refund_y")),
        price: scalar("price"),
        market_id: scalar("market_id"),
        participant_id: wide("participant_id"),
        blinding: scalar("blinding"),
        nullifier_seed: scalar("nullifier_seed"),
    }
}

fn point(x: &str, y: &str) -> [u8; 64] {
    let mut out = [0u8; 64];
    out[..32].copy_from_slice(&unhex::<32>(x));
    out[32..].copy_from_slice(&unhex::<32>(y));
    out
}

fn unhex<const N: usize>(text: &str) -> [u8; N] {
    let digits = text.trim_matches('"');
    let digits = digits
        .strip_prefix("0x")
        .unwrap_or_else(|| panic!("`{text}` is not in hexadecimal"));
    assert_eq!(
        digits.len(),
        N * 2,
        "`{text}` does not have {N} bytes: the Prover.toml field changed size"
    );

    let mut out = [0u8; N];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&digits[2 * i..2 * i + 2], 16)
            .unwrap_or_else(|err| panic!("`{text}` is not hex: {err}"));
    }
    out
}

pub struct SettleWorld {
    pub e: Env,
    pub auction: Address,
    pub seller: Address,

    pub bidder: Address,
    pub fee_wallet: Address,
    pub fee_asset: Address,
    pub quota_asset: Address,
    pub collateral_token: Address,
    pub case: SettleCase,
}

impl SettleWorld {
    pub fn filled(&self) -> u32 {
        self.bid_record().filled_quantity
    }

    pub fn bid_record(&self) -> BidRecord {
        self.e.invoke_contract(
            &self.auction,
            &Symbol::new(&self.e, "get_bid_record"),
            vec![&self.e, 0u32.into_val(&self.e)],
        )
    }

    pub fn state(&self) -> MarketStatus {
        self.e.invoke_contract(
            &self.auction,
            &Symbol::new(&self.e, "get_state"),
            Vec::new(&self.e),
        )
    }

    pub fn legs(&self) -> Vec<LegRecord> {
        self.e.invoke_contract(
            &self.collateral_token,
            &Symbol::new(&self.e, "legs"),
            Vec::new(&self.e),
        )
    }

    pub fn bidder_quotas(&self) -> i128 {
        TokenClient::new(&self.e, &self.quota_asset).balance(&self.bidder)
    }

    pub fn escrow(&self) -> i128 {
        TokenClient::new(&self.e, &self.quota_asset).balance(&self.auction)
    }

    pub fn seller_fees(&self) -> i128 {
        TokenClient::new(&self.e, &self.fee_asset).balance(&self.seller)
    }
}

pub fn settle_world(case: &str) -> SettleWorld {
    let c = settle_case(case);

    assert_eq!(
        c.market_id, MARKET_ID,
        "the {case} fixture is from another market"
    );
    assert_eq!(
        c.participant_id, BIDDER_ID,
        "the {case} fixture is from another participant"
    );
    assert_eq!(
        c.requested_quantity, REQUESTED_QUANTITY,
        "the {case} fixture requests something else"
    );
    assert_eq!(
        c.fee_bps, FEE_BPS,
        "the {case} fixture was proved with another fee: `fee_bps` is a public input"
    );

    let e = Env::default();
    e.mock_all_auths();
    e.ledger().with_mut(|li| li.sequence_number = START_LEDGER);

    let admin = Address::generate(&e);
    let seller = Address::generate(&e);
    let bidder = Address::generate(&e);
    let fee_wallet = Address::generate(&e);

    let token = e.register(FakeConfidentialToken, ());
    let settle_vk = read_repo(
        "../../artifacts/vks/settlement_binding.vk.bin",
        "run ./scripts/circuits.sh (step 5.1)",
    );

    let settlement_verifier = e.register(ULTRAHONK_VERIFIER, (Bytes::from_slice(&e, &settle_vk),));
    let fee_asset = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let quota_asset = e.register_stellar_asset_contract_v2(admin).address();

    let platform = PlatformConfig {
        collateral_token: token.clone(),
        fee_asset: fee_asset.clone(),

        bid_verifier: Address::generate(&e),
        allocation_verifier: Address::generate(&e),
        settlement_verifier,
        fee_wallet: fee_wallet.clone(),
        auditor_id: 7,
        finalization_grace_ledgers: shared::types::FINALIZATION_GRACE_LEDGERS,
    };
    let params = MarketParams {
        quota_asset: quota_asset.clone(),
        total_quotas: c.requested_quantity,
        min_price_per_quota: MIN_PRICE_PER_QUOTA,
        close_ledger: CLOSE_LEDGER,
        eligibility_policy: None,
        fee_reserve: MIN_FEE_RESERVE,
    };

    let auction = e.register(
        Auction,
        (
            c.market_id,
            seller.clone(),
            params,
            platform,
            Bytes::from_array(&e, &REGISTER_DATA),
        ),
    );

    for account in [&seller, &fee_wallet] {
        e.invoke_contract::<()>(
            &token,
            &Symbol::new(&e, "open_account"),
            vec![&e, account.into_val(&e)],
        );
    }

    StellarAssetClient::new(&e, &fee_asset).mint(&seller, &MIN_FEE_RESERVE);
    TokenClient::new(&e, &fee_asset).transfer(&seller, &auction, &MIN_FEE_RESERVE);
    StellarAssetClient::new(&e, &quota_asset)
        .mint(&seller, &(c.requested_quantity as i128 * QUOTA_UNIT));
    e.invoke_contract::<()>(&auction, &Symbol::new(&e, "open_market"), Vec::new(&e));

    let commitment = auction::crypto::commitment(
        &e,
        c.price,
        c.market_id,
        c.participant_id,
        c.blinding,
        c.nullifier_seed,
    );
    assert_eq!(
        commitment.to_array(),
        c.commitment,
        "the commitment derived from the witnesses is not the `bid_commitment` of the Prover.toml of {case}"
    );

    let mut bids = Vec::new(&e);
    bids.push_back(BidRecord {
        bidder: bidder.clone(),
        participant_id: c.participant_id,
        commitment,
        nullifier: BytesN::from_array(&e, &[0; 32]),
        requested_quantity: c.requested_quantity,
        envelope: BidEnvelope {
            r_point: BytesN::from_array(&e, &[0; 64]),
            ct_price: BytesN::from_array(&e, &[0; 32]),
            ct_blinding: BytesN::from_array(&e, &[0; 32]),
            ct_seed: BytesN::from_array(&e, &[0; 32]),
        },
        filled_quantity: c.filled_quantity,
        status: BidStatus::Pending,
    });

    e.as_contract(&auction, || {
        let storage = e.storage().instance();
        storage.set(&DataKey::Bids, &bids);
        storage.set(&DataKey::State, &MarketStatus::Finalized);
        storage.set(&DataKey::OpenBids, &1u32);
    });

    SettleWorld {
        e,
        auction,
        seller,
        bidder,
        fee_wallet,
        fee_asset,
        quota_asset,
        collateral_token: token,
        case: c,
    }
}

pub fn leg(w: &SettleWorld, c_tx: &BytesN<64>) -> Bytes {
    leg_to(&w.e, c_tx)
}

pub fn leg_to(e: &Env, c_tx: &BytesN<64>) -> Bytes {
    SpenderTransferData {
        payload: SpenderTransferPayload {
            c_a_new: BytesN::from_array(e, &[0; 64]),
            c_tx: c_tx.clone(),
            r_e: BytesN::from_array(e, &[0; 64]),
            v_tilde: BytesN::from_array(e, &[0; 32]),
            a_tilde_new: BytesN::from_array(e, &[0; 32]),
            sigma_a_new: BytesN::from_array(e, &[0; 32]),
            v_aud_r: BytesN::from_array(e, &[0; 32]),
            r_aud_r: BytesN::from_array(e, &[0; 32]),
            v_aud_s: BytesN::from_array(e, &[0; 32]),
            a_aud_s: BytesN::from_array(e, &[0; 32]),
        },
        proof: Bytes::new(e),
    }
    .to_xdr(e)
}

pub fn legs(w: &SettleWorld) -> (Bytes, Bytes, Bytes) {
    (
        leg(w, &BytesN::from_array(&w.e, &w.case.c_seller)),
        leg(w, &BytesN::from_array(&w.e, &w.case.c_fee)),
        leg(w, &BytesN::from_array(&w.e, &w.case.c_refund)),
    )
}

pub fn settle_proof(case: &str) -> std::vec::Vec<u8> {
    read_repo(
        &std::format!("../../artifacts/fixtures/settlement_binding/{case}/proof"),
        "run ./scripts/fixtures.sh",
    )
}

pub fn settle_public_inputs(case: &str) -> std::vec::Vec<u8> {
    read_repo(
        &std::format!("../../artifacts/fixtures/settlement_binding/{case}/public_inputs"),
        "run ./scripts/fixtures.sh",
    )
}

#[allow(clippy::too_many_arguments)]
pub fn settle(
    w: &SettleWorld,
    caller: &Address,
    bid_index: u32,
    seller_data: &Bytes,
    fee_data: &Bytes,
    refund_data: &Bytes,
    proof: &[u8],
) -> Result<SettleOutcome, Result<AuctionError, soroban_sdk::InvokeError>> {
    settle_to(
        &w.e,
        &w.auction,
        caller,
        bid_index,
        seller_data,
        fee_data,
        refund_data,
        proof,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn settle_to(
    e: &Env,
    auction: &Address,
    caller: &Address,
    bid_index: u32,
    seller_data: &Bytes,
    fee_data: &Bytes,
    refund_data: &Bytes,
    proof: &[u8],
) -> Result<SettleOutcome, Result<AuctionError, soroban_sdk::InvokeError>> {
    let args = vec![
        e,
        caller.into_val(e),
        bid_index.into_val(e),
        seller_data.into_val(e),
        fee_data.into_val(e),
        refund_data.into_val(e),
        Bytes::from_slice(e, proof).into_val(e),
    ];
    match e.try_invoke_contract::<SettleOutcome, AuctionError>(
        auction,
        &Symbol::new(e, "settle"),
        args,
    ) {
        Ok(Ok(outcome)) => Ok(outcome),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(err) => Err(err),
    }
}

pub struct FullWorld {
    pub e: Env,
    pub auction: Address,
    pub seller: Address,
    pub fee_asset: Address,
    pub quota_asset: Address,
    pub collateral_token: Address,

    pub scenario_name: &'static str,
    pub scenario: Scenario,

    pub keeper: Address,

    pub bidders: std::vec::Vec<Address>,
}

impl FullWorld {
    pub fn state(&self) -> MarketStatus {
        self.e.invoke_contract(
            &self.auction,
            &Symbol::new(&self.e, "get_state"),
            Vec::new(&self.e),
        )
    }

    pub fn participant_id(&self, participant: &Address) -> u32 {
        self.e
            .invoke_contract::<Option<u32>>(
                &self.auction,
                &Symbol::new(&self.e, "get_participant_id"),
                vec![&self.e, participant.into_val(&self.e)],
            )
            .expect("the bidder was registered")
    }

    pub fn bid_count(&self) -> u32 {
        self.e.invoke_contract(
            &self.auction,
            &Symbol::new(&self.e, "get_bid_count"),
            Vec::new(&self.e),
        )
    }

    pub fn bid_record(&self, bid_index: u32) -> BidRecord {
        self.e.invoke_contract(
            &self.auction,
            &Symbol::new(&self.e, "get_bid_record"),
            vec![&self.e, bid_index.into_val(&self.e)],
        )
    }

    pub fn settlement_status(&self, bid_index: u32) -> BidStatus {
        self.e.invoke_contract(
            &self.auction,
            &Symbol::new(&self.e, "get_settlement_status"),
            vec![&self.e, bid_index.into_val(&self.e)],
        )
    }

    pub fn allocation(&self) -> Vec<u32> {
        self.e.invoke_contract(
            &self.auction,
            &Symbol::new(&self.e, "get_allocation"),
            Vec::new(&self.e),
        )
    }

    pub fn root(&self) -> Option<BytesN<32>> {
        self.e.invoke_contract(
            &self.auction,
            &Symbol::new(&self.e, "get_commitments_root"),
            Vec::new(&self.e),
        )
    }

    pub fn commitments_root(&self) -> BytesN<32> {
        let mut commitments = Vec::new(&self.e);
        for bid in 0..self.scenario.bid_count {
            commitments.push_back(self.bid_record(bid).commitment);
        }
        auction::crypto::commitments_root(&self.e, &commitments)
    }

    pub fn legs(&self) -> Vec<LegRecord> {
        self.e.invoke_contract(
            &self.collateral_token,
            &Symbol::new(&self.e, "legs"),
            Vec::new(&self.e),
        )
    }

    pub fn escrow(&self) -> i128 {
        TokenClient::new(&self.e, &self.quota_asset).balance(&self.auction)
    }

    pub fn seller_quotas(&self) -> i128 {
        self.quotas_of(&self.seller)
    }

    pub fn quotas_of(&self, who: &Address) -> i128 {
        TokenClient::new(&self.e, &self.quota_asset).balance(who)
    }

    pub fn fees_of(&self, who: &Address) -> i128 {
        TokenClient::new(&self.e, &self.fee_asset).balance(who)
    }

    pub fn submit(&self, bid: u32) -> u32 {
        let case = bid_case_of(self.scenario_name, bid);
        let proof = bid_proof(case);
        let submission = submission_of(&self.e, case, &proof);
        submit_to(
            &self.e,
            &self.auction,
            &self.bidders[bid as usize],
            &submission,
        )
        .unwrap_or_else(|err| panic!("bid {bid} ({case}) did not enter: {err:?}"))
    }

    pub fn close(&self) {
        self.e
            .ledger()
            .with_mut(|li| li.sequence_number = CLOSE_LEDGER);
        self.e.invoke_contract::<()>(
            &self.auction,
            &Symbol::new(&self.e, "close_market"),
            vec![&self.e, self.keeper.into_val(&self.e)],
        );
    }

    pub fn finalize(&self) {
        let filled = quantities(
            &self.e,
            &self.scenario.filled[..self.scenario.bid_count as usize],
        );
        finalize_to(
            &self.e,
            &self.auction,
            &self.keeper,
            &filled,
            &alloc_proof(self.scenario_name),
        )
        .unwrap_or_else(|err| {
            panic!(
                "the finalize of {} did not pass: {err:?}",
                self.scenario_name
            )
        });
    }

    pub fn expire(&self) {
        self.e.ledger().with_mut(|li| {
            li.sequence_number = CLOSE_LEDGER + FINALIZATION_GRACE_LEDGERS + 1;
        });
        self.e.invoke_contract::<()>(
            &self.auction,
            &Symbol::new(&self.e, "cancel_expired"),
            vec![&self.e, self.keeper.into_val(&self.e)],
        );
    }

    pub fn revoke_delegation(&self, bid: u32) {
        let args = vec![
            &self.e,
            self.bidders[bid as usize].into_val(&self.e),
            self.auction.into_val(&self.e),
        ];
        self.e.invoke_contract::<()>(
            &self.collateral_token,
            &Symbol::new(&self.e, "revoke_delegation"),
            args,
        );
    }

    pub fn release(&self, bid: u32) {
        self.e.invoke_contract::<()>(
            &self.auction,
            &Symbol::new(&self.e, "release_unsettled"),
            vec![
                &self.e,
                self.keeper.into_val(&self.e),
                bid.into_val(&self.e),
            ],
        );
    }

    pub fn settle(&self, bid: u32) -> SettleOutcome {
        let filled = self.bid_record(bid).filled_quantity;
        let case = settle_case_of(self.scenario_name, bid, filled);
        let c = settle_case(&case);
        settle_to(
            &self.e,
            &self.auction,
            &self.bidders[bid as usize],
            bid,
            &leg_to(&self.e, &BytesN::from_array(&self.e, &c.c_seller)),
            &leg_to(&self.e, &BytesN::from_array(&self.e, &c.c_fee)),
            &leg_to(&self.e, &BytesN::from_array(&self.e, &c.c_refund)),
            &settle_proof(&case),
        )
        .unwrap_or_else(|err| panic!("the settle of bid {bid} ({case}) did not pass: {err:?}"))
    }
}

pub fn full_world(scenario_name: &'static str) -> FullWorld {
    let o = open_scenario(scenario_name);
    let s = o.scenario;

    let mut bidders = std::vec::Vec::new();
    for bid in 0..s.bid_count {
        let bidder = Address::generate(&o.e);

        let id = register_participant(&o.e, &o.auction, &bidder);
        assert_eq!(
            id, bid,
            "registration {bid} of {scenario_name} did not yield participant_id {bid}"
        );

        let case = bid_case_of(scenario_name, bid);
        set_delegation_to(
            &o.e,
            &o.collateral_token,
            &o.auction,
            &bidder,
            &collateral_binding_of(&o.e, case),
        );
        bidders.push(bidder);
    }

    let keeper = Address::generate(&o.e);

    FullWorld {
        e: o.e,
        auction: o.auction,
        seller: o.seller,
        fee_asset: o.fee_asset,
        quota_asset: o.quota_asset,
        collateral_token: o.collateral_token,
        scenario_name,
        scenario: s,
        keeper,
        bidders,
    }
}
