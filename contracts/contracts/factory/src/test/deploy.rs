use shared::types::{
    MarketConfig, MarketParams, MarketStatus, PlatformConfig, AUCTION_RULE, FEE_BPS,
    FINALIZATION_GRACE_LEDGERS, MAX_BIDS, MAX_DURATION_LEDGERS, MIN_FEE_RESERVE, QUOTA_UNIT,
    SETTLEMENT_MARGIN_LEDGERS, TTL_BUFFER_LEDGERS,
};
use soroban_sdk::testutils::storage::{Instance as _, Persistent as _};
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{
    contract, contractimpl, contracttype, Address, Bytes, BytesN, Env, IntoVal, Map, Symbol, Val,
    Vec,
};

use crate::{DataKey, Factory, FactoryError};

const AUCTION_WASM: &[u8] = include_bytes!("../../../../wasm/auction.wasm");

const START_LEDGER: u32 = 1_000_000;

const SELLER_FUNDING: i128 = 100 * QUOTA_UNIT;

const REGISTER_DATA: [u8; 3] = [1, 2, 3];

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Registration {
    pub account: Address,
    pub auditor_id: u32,
    pub data: Bytes,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FakeTokenKey {
    Registration(Address),
    Accounts,

    OpenAccount(Address),
}

#[contract]
pub struct FakeConfidentialToken;

#[contractimpl]
impl FakeConfidentialToken {
    pub fn register(e: Env, account: Address, auditor_id: u32, data: Bytes) {
        let storage = e.storage().instance();
        storage.set(
            &FakeTokenKey::Registration(account.clone()),
            &Registration {
                account: account.clone(),
                auditor_id,
                data,
            },
        );

        let mut accounts: Vec<Address> =
            storage.get(&FakeTokenKey::Accounts).unwrap_or(Vec::new(&e));
        accounts.push_back(account);
        storage.set(&FakeTokenKey::Accounts, &accounts);
    }

    pub fn registration(e: Env, account: Address) -> Registration {
        e.storage()
            .instance()
            .get(&FakeTokenKey::Registration(account))
            .expect("account not registered")
    }

    pub fn open_account(e: Env, account: Address) {
        e.storage()
            .instance()
            .set(&FakeTokenKey::OpenAccount(account), &());
    }

    pub fn confidential_balance(e: Env, account: Address) -> Address {
        let storage = e.storage().instance();
        if !storage.has(&FakeTokenKey::Registration(account.clone()))
            && !storage.has(&FakeTokenKey::OpenAccount(account.clone()))
        {
            panic!("AccountNotRegistered");
        }
        account
    }

    pub fn registered_count(e: Env) -> u32 {
        let accounts: Vec<Address> = e
            .storage()
            .instance()
            .get(&FakeTokenKey::Accounts)
            .unwrap_or(Vec::new(&e));
        accounts.len()
    }
}

struct World {
    e: Env,
    admin: Address,
    seller: Address,
    factory: Address,
    token: Address,
    fee_asset: Address,
    quota_asset: Address,
    platform: PlatformConfig,
}

fn new_world() -> World {
    new_world_with(true, true)
}

fn new_world_with(seller_registered: bool, fee_wallet_registered: bool) -> World {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().with_mut(|li| li.sequence_number = START_LEDGER);

    let admin = Address::generate(&e);
    let seller = Address::generate(&e);

    let token = e.register(FakeConfidentialToken, ());
    let fee_asset = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let quota_asset = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();

    let platform = PlatformConfig {
        collateral_token: token.clone(),
        fee_asset: fee_asset.clone(),
        bid_verifier: Address::generate(&e),
        allocation_verifier: Address::generate(&e),
        settlement_verifier: Address::generate(&e),
        fee_wallet: Address::generate(&e),
        auditor_id: 7,
        finalization_grace_ledgers: shared::types::FINALIZATION_GRACE_LEDGERS,
    };

    let wasm_hash = e
        .deployer()
        .upload_contract_wasm(Bytes::from_slice(&e, AUCTION_WASM));
    let factory = e.register(Factory, (admin.clone(), wasm_hash, platform.clone()));

    e.mock_all_auths();

    let world = World {
        e,
        admin,
        seller,
        factory,
        token,
        fee_asset,
        quota_asset,
        platform,
    };

    world.fund(&world.seller, SELLER_FUNDING);
    if seller_registered {
        world.open_account(&world.seller);
    }
    if fee_wallet_registered {
        world.open_account(&world.platform.fee_wallet);
    }
    world
}

impl World {
    fn params(&self) -> MarketParams {
        MarketParams {
            quota_asset: self.quota_asset.clone(),
            total_quotas: 10,
            min_price_per_quota: 100,
            close_ledger: START_LEDGER + 1_000,
            eligibility_policy: None,
            fee_reserve: MIN_FEE_RESERVE,
        }
    }

    fn register_data(&self) -> Bytes {
        Bytes::from_array(&self.e, &REGISTER_DATA)
    }

    fn create_args(&self, params: &MarketParams) -> Vec<Val> {
        soroban_sdk::vec![
            &self.e,
            self.seller.into_val(&self.e),
            params.into_val(&self.e),
            self.register_data().into_val(&self.e),
        ]
    }

    #[allow(clippy::type_complexity)]
    fn call_create(
        &self,
        params: &MarketParams,
    ) -> Result<
        Result<(u64, Address), soroban_sdk::Error>,
        Result<FactoryError, soroban_sdk::InvokeError>,
    > {
        self.e.try_invoke_contract::<(u64, Address), FactoryError>(
            &self.factory,
            &Symbol::new(&self.e, "create_market"),
            self.create_args(params),
        )
    }

    fn create(&self, params: &MarketParams) -> (u64, Address) {
        match self.call_create(params) {
            Ok(Ok(v)) => v,
            Ok(Err(_)) => panic!("the contract return did not convert"),
            Err(Ok(err)) => panic!("create_market rejected: {err:?}"),
            Err(Err(err)) => panic!("the call did not reach the contract: {err:?}"),
        }
    }

    fn create_err(&self, params: &MarketParams) -> FactoryError {
        match self.call_create(params) {
            Ok(Ok(_)) => panic!("create_market succeeded when it should have failed"),
            Ok(Err(_)) => panic!("the contract return did not convert"),
            Err(Ok(err)) => err,
            Err(Err(err)) => panic!("the call did not reach the contract: {err:?}"),
        }
    }

    fn state_of(&self, auction: &Address) -> MarketStatus {
        invoke_no_args(&self.e, auction, "get_state")
    }

    fn cancel(&self, auction: &Address) {
        invoke_no_args::<()>(&self.e, auction, "cancel_market")
    }

    fn market_of(&self, auction: &Address) -> MarketConfig {
        invoke_no_args(&self.e, auction, "get_market")
    }

    fn registry(&self, market_id: u64) -> Result<Address, FactoryError> {
        let args = soroban_sdk::vec![&self.e, market_id.into_val(&self.e)];
        match self.e.try_invoke_contract::<Address, FactoryError>(
            &self.factory,
            &Symbol::new(&self.e, "get_market_address"),
            args,
        ) {
            Ok(Ok(v)) => Ok(v),
            Ok(Err(_)) => panic!("the contract return did not convert"),
            Err(Ok(err)) => Err(err),
            Err(Err(err)) => panic!("the call did not reach the contract: {err:?}"),
        }
    }

    fn predict(&self, market_id: u64) -> Address {
        let args = soroban_sdk::vec![&self.e, market_id.into_val(&self.e)];
        self.e.invoke_contract(
            &self.factory,
            &Symbol::new(&self.e, "predict_market_address"),
            args,
        )
    }

    fn set_auction_wasm(&self, wasm_hash: &BytesN<32>) {
        let args = soroban_sdk::vec![&self.e, wasm_hash.into_val(&self.e)];
        self.e.invoke_contract::<()>(
            &self.factory,
            &Symbol::new(&self.e, "set_auction_wasm"),
            args,
        );
    }

    fn fund(&self, who: &Address, amount: i128) {
        StellarAssetClient::new(&self.e, &self.fee_asset).mint(who, &amount);
        StellarAssetClient::new(&self.e, &self.quota_asset).mint(who, &amount);
    }

    fn fee_balance(&self, who: &Address) -> i128 {
        TokenClient::new(&self.e, &self.fee_asset).balance(who)
    }

    fn quota_balance(&self, who: &Address) -> i128 {
        TokenClient::new(&self.e, &self.quota_asset).balance(who)
    }

    fn registration(&self, account: &Address) -> Registration {
        let args = soroban_sdk::vec![&self.e, account.into_val(&self.e)];
        self.e
            .invoke_contract(&self.token, &Symbol::new(&self.e, "registration"), args)
    }

    fn open_account(&self, account: &Address) {
        self.e.invoke_contract::<()>(
            &self.token,
            &Symbol::new(&self.e, "open_account"),
            soroban_sdk::vec![&self.e, account.into_val(&self.e)],
        );
    }

    fn registered_count(&self) -> u32 {
        invoke_no_args(&self.e, &self.token, "registered_count")
    }

    fn factory_events(&self) -> soroban_sdk::testutils::ContractEvents {
        self.e.events().all().filter_by_contract(&self.factory)
    }

    fn market_created(&self, market_id: u64, auction: &Address) -> (Address, Vec<Val>, Val) {
        let mut data = Map::new(&self.e);
        data.set(Symbol::new(&self.e, "auction"), auction.clone());
        data.set(Symbol::new(&self.e, "seller"), self.seller.clone());

        (
            self.factory.clone(),
            soroban_sdk::vec![
                &self.e,
                Symbol::new(&self.e, "market_created").into_val(&self.e),
                market_id.into_val(&self.e),
            ],
            data.into_val(&self.e),
        )
    }
}

fn invoke_no_args<T: soroban_sdk::TryFromVal<Env, Val>>(
    e: &Env,
    contract: &Address,
    fname: &str,
) -> T {
    e.invoke_contract(contract, &Symbol::new(e, fname), Vec::new(e))
}

#[test]
fn create_market_deploys_one_auction_per_market() {
    let w = new_world();
    let params = w.params();

    let (first_id, first) = w.create(&params);
    let (second_id, second) = w.create(&params);

    assert_ne!(first, second);
    assert_ne!(first, w.factory);
    assert_ne!(first_id, second_id);
}

#[test]
fn auction_stores_market_id_given_by_factory() {
    let w = new_world();

    let (market_id, auction) = w.create(&w.params());

    assert_eq!(w.market_of(&auction).market_id, market_id);
    assert_eq!(market_id, 1);
}

#[test]
fn auction_stores_the_seller_config_and_the_platform_constants() {
    let w = new_world();
    let params = w.params();

    let (_, auction) = w.create(&params);
    let config = w.market_of(&auction);

    assert_eq!(config.seller, w.seller);
    assert_eq!(config.params, params);
    assert_eq!(config.platform, w.platform);
    assert_eq!(
        config.finalization_grace_ledgers,
        FINALIZATION_GRACE_LEDGERS
    );
    assert_eq!(config.fee_bps, FEE_BPS);
    assert_eq!(config.auction_rule, AUCTION_RULE);
    assert_eq!(config.max_bids, MAX_BIDS);
}

#[test]
fn registry_resolves_to_deployed_address() {
    let w = new_world();

    let (market_id, auction) = w.create(&w.params());

    assert_eq!(w.registry(market_id), Ok(auction));
}

#[test]
fn cancelled_market_id_is_not_reused() {
    let w = new_world();

    let (first_id, first) = w.create(&w.params());
    w.cancel(&first);

    let (second_id, second) = w.create(&w.params());

    assert_eq!(second_id, first_id + 1);
    assert_ne!(
        second, first,
        "the new id landed on the address of the cancelled one"
    );
    assert_eq!(w.registry(first_id), Ok(first));
    assert_eq!(w.registry(second_id), Ok(second));
}

#[test]
fn predict_market_address_matches_deployed() {
    let w = new_world();
    let params = w.params();

    let predicted = w.predict(1);
    let (market_id, auction) = w.create(&params);

    assert_eq!(market_id, 1);
    assert_eq!(predicted, auction);
}

#[test]
fn constructor_registers_in_token() {
    let w = new_world();
    let params = w.params();
    let predicted = w.predict(1);

    let (_, auction) = w.create(&params);

    assert_eq!(auction, predicted);
    assert_eq!(w.registered_count(), 1);

    let registration = w.registration(&auction);
    assert_eq!(registration.account, auction);
    assert_eq!(registration.auditor_id, w.platform.auditor_id);
    assert_eq!(registration.data, w.register_data());
}

#[test]
fn auction_starts_created() {
    let w = new_world();

    let (_, auction) = w.create(&w.params());

    assert_eq!(w.state_of(&auction), MarketStatus::Created);
}

#[test]
fn fee_reserve_moves_from_seller_to_auction() {
    let w = new_world();
    let params = w.params();
    let before = w.fee_balance(&w.seller);

    let (_, auction) = w.create(&params);

    assert_eq!(w.fee_balance(&w.seller), before - params.fee_reserve);
    assert_eq!(w.fee_balance(&auction), params.fee_reserve);
}

#[test]
fn create_market_moves_no_quota() {
    let w = new_world();
    let before = w.quota_balance(&w.seller);

    let (_, auction) = w.create(&w.params());

    assert_eq!(w.quota_balance(&w.seller), before);
    assert_eq!(w.quota_balance(&auction), 0);
}

#[test]
fn create_market_requires_seller_auth() {
    let w = new_world();
    let params = w.params();

    let impostor = Address::generate(&w.e);
    let args = w.create_args(&params);
    w.e.mock_auths(&[MockAuth {
        address: &impostor,
        invoke: &MockAuthInvoke {
            contract: &w.factory,
            fn_name: "create_market",
            args,
            sub_invokes: &[],
        },
    }]);

    assert!(
        w.call_create(&params).is_err(),
        "an impostor cannot create a market on behalf of the seller"
    );
    assert_eq!(w.registered_count(), 0);
}

#[test]
fn market_created_event_has_id_and_address() {
    let w = new_world();

    let (market_id, auction) = w.create(&w.params());
    let expected = soroban_sdk::vec![&w.e, w.market_created(market_id, &auction)];

    assert_eq!(w.factory_events(), expected);
}

#[test]
fn zero_total_quotas_fails() {
    let w = new_world();
    let mut params = w.params();
    params.total_quotas = 0;

    assert_eq!(w.create_err(&params), FactoryError::InvalidTotalQuotas);
    assert_eq!(w.registered_count(), 0);
}

#[test]
fn zero_min_price_fails() {
    let w = new_world();
    let mut params = w.params();
    params.min_price_per_quota = 0;

    assert_eq!(w.create_err(&params), FactoryError::InvalidMinPrice);
    assert_eq!(w.registered_count(), 0);
}

#[test]
fn min_price_ge_2_pow_63_fails() {
    let w = new_world();
    let mut params = w.params();
    params.min_price_per_quota = 1 << 63;

    assert_eq!(w.create_err(&params), FactoryError::InvalidMinPrice);
}

#[test]
fn close_ledger_in_past_fails() {
    let w = new_world();
    let mut params = w.params();
    params.close_ledger = START_LEDGER;

    assert_eq!(w.create_err(&params), FactoryError::InvalidCloseLedger);
}

#[test]
fn duration_over_30_days_fails() {
    let w = new_world();
    let mut params = w.params();
    params.close_ledger = START_LEDGER + MAX_DURATION_LEDGERS + 1;

    assert_eq!(w.create_err(&params), FactoryError::DurationTooLong);
}

#[test]
fn fee_reserve_below_min_fee_reserve_fails() {
    let w = new_world();
    let mut params = w.params();
    params.fee_reserve = MIN_FEE_RESERVE - 1;

    assert_eq!(w.create_err(&params), FactoryError::InvalidFeeReserve);
}

#[test]
fn unregistered_seller_fails() {
    let w = new_world_with(false, true);

    assert_eq!(w.create_err(&w.params()), FactoryError::SellerNotRegistered);
    assert_eq!(w.registered_count(), 0);
    assert_eq!(
        invoke_no_args::<u64>(&w.e, &w.factory, "next_market_id"),
        1,
        "the refusal must not consume market_id"
    );
}

#[test]
fn unregistered_fee_wallet_fails() {
    let w = new_world_with(true, false);

    assert_eq!(
        w.create_err(&w.params()),
        FactoryError::FeeWalletNotRegistered
    );
    assert_eq!(w.registered_count(), 0);
    assert_eq!(invoke_no_args::<u64>(&w.e, &w.factory, "next_market_id"), 1);
}

#[test]
fn registered_fee_wallet_set_later_unblocks_creation() {
    let w = new_world_with(true, false);
    assert_eq!(
        w.create_err(&w.params()),
        FactoryError::FeeWalletNotRegistered
    );

    let wallet = Address::generate(&w.e);
    w.open_account(&wallet);
    let mut platform = w.platform.clone();
    platform.fee_wallet = wallet;
    w.e.invoke_contract::<()>(
        &w.factory,
        &Symbol::new(&w.e, "set_platform_config"),
        soroban_sdk::vec![&w.e, platform.into_val(&w.e)],
    );

    let (market_id, _) = w.create(&w.params());
    assert_eq!(market_id, 1);
}

fn factory_horizon() -> u32 {
    MAX_DURATION_LEDGERS
        + FINALIZATION_GRACE_LEDGERS
        + SETTLEMENT_MARGIN_LEDGERS
        + TTL_BUFFER_LEDGERS
}

fn factory_instance_live_until(w: &World) -> u32 {
    let ttl =
        w.e.as_contract(&w.factory, || w.e.storage().instance().get_ttl());
    w.e.ledger().sequence() + ttl
}

fn registry_live_until(w: &World, market_id: u64) -> u32 {
    let ttl = w.e.as_contract(&w.factory, || {
        w.e.storage()
            .persistent()
            .get_ttl(&DataKey::Market(market_id))
    });
    w.e.ledger().sequence() + ttl
}

#[test]
fn constructor_extends_instance_ttl() {
    let w = new_world();
    assert!(factory_instance_live_until(&w) >= START_LEDGER + factory_horizon());
}

#[test]
fn create_market_extends_instance_and_registry_ttl() {
    let w = new_world();
    let later = START_LEDGER + 10_000;
    w.e.ledger().with_mut(|li| li.sequence_number = later);

    let mut params = w.params();
    params.close_ledger = later + 1_000;
    let (market_id, _) = w.create(&params);

    assert!(factory_instance_live_until(&w) >= later + factory_horizon());
    assert!(
        registry_live_until(&w, market_id)
            >= params.close_ledger
                + FINALIZATION_GRACE_LEDGERS
                + SETTLEMENT_MARGIN_LEDGERS
                + TTL_BUFFER_LEDGERS,
        "the registry of market {market_id} expires before the market"
    );
}

#[test]
fn admin_writes_extend_instance_ttl() {
    let w = new_world();
    let later = START_LEDGER + 50_000;
    w.e.ledger().with_mut(|li| li.sequence_number = later);

    w.e.invoke_contract::<()>(
        &w.factory,
        &Symbol::new(&w.e, "set_platform_config"),
        soroban_sdk::vec![&w.e, w.platform.clone().into_val(&w.e)],
    );
    assert!(factory_instance_live_until(&w) >= later + factory_horizon());
}

#[test]
fn set_auction_wasm_only_admin() {
    let w = new_world();
    let new_wasm = BytesN::from_array(&w.e, &[9u8; 32]);

    let admin_auth = MockAuth {
        address: &w.admin,
        invoke: &MockAuthInvoke {
            contract: &w.factory,
            fn_name: "set_auction_wasm",
            args: soroban_sdk::vec![&w.e, new_wasm.into_val(&w.e)],
            sub_invokes: &[],
        },
    };
    w.e.mock_auths(&[admin_auth]);
    w.set_auction_wasm(&new_wasm);

    let impostor = Address::generate(&w.e);
    let impostor_auth = MockAuth {
        address: &impostor,
        invoke: &MockAuthInvoke {
            contract: &w.factory,
            fn_name: "set_auction_wasm",
            args: soroban_sdk::vec![&w.e, new_wasm.into_val(&w.e)],
            sub_invokes: &[],
        },
    };
    w.e.mock_auths(&[impostor_auth]);

    let args = soroban_sdk::vec![&w.e, new_wasm.into_val(&w.e)];
    assert!(
        w.e.try_invoke_contract::<(), FactoryError>(
            &w.factory,
            &Symbol::new(&w.e, "set_auction_wasm"),
            args,
        )
        .is_err(),
        "only the admin can change the Auction WASM"
    );
}

#[test]
fn new_wasm_only_affects_new_markets() {
    let w = new_world();

    let (_, existing) = w.create(&w.params());
    let config_before = w.market_of(&existing);

    let new_wasm =
        w.e.deployer()
            .upload_contract_wasm(Bytes::from_slice(&w.e, AUCTION_WASM));
    w.set_auction_wasm(&new_wasm);

    assert_eq!(w.market_of(&existing), config_before);
    assert_eq!(w.state_of(&existing), MarketStatus::Created);

    let (id, fresh) = w.create(&w.params());
    assert_eq!(id, 2);
    assert_ne!(fresh, existing);
}

fn try_set_platform(w: &World, platform: &PlatformConfig) -> Result<(), FactoryError> {
    match w.e.try_invoke_contract::<(), FactoryError>(
        &w.factory,
        &Symbol::new(&w.e, "set_platform_config"),
        soroban_sdk::vec![&w.e, platform.into_val(&w.e)],
    ) {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(Ok(err)) => Err(err),
        Err(Err(_)) => panic!("the call did not reach the contract"),
    }
}

#[test]
fn set_platform_config_rejects_a_grace_outside_the_bounds() {
    let w = new_world();
    for grace in [
        0,
        shared::types::MIN_FINALIZATION_GRACE_LEDGERS - 1,
        shared::types::MAX_FINALIZATION_GRACE_LEDGERS + 1,
    ] {
        let mut p = w.platform.clone();
        p.finalization_grace_ledgers = grace;
        assert_eq!(
            try_set_platform(&w, &p),
            Err(FactoryError::InvalidFinalizationGrace),
            "grace {grace}"
        );
    }
    for grace in [
        shared::types::MIN_FINALIZATION_GRACE_LEDGERS,
        shared::types::MAX_FINALIZATION_GRACE_LEDGERS,
    ] {
        let mut p = w.platform.clone();
        p.finalization_grace_ledgers = grace;
        assert_eq!(try_set_platform(&w, &p), Ok(()), "grace {grace}");
    }
}

#[test]
#[should_panic]
fn constructor_rejects_a_grace_below_the_floor() {
    let e = Env::default();
    let mut platform = PlatformConfig {
        collateral_token: Address::generate(&e),
        fee_asset: Address::generate(&e),
        bid_verifier: Address::generate(&e),
        allocation_verifier: Address::generate(&e),
        settlement_verifier: Address::generate(&e),
        fee_wallet: Address::generate(&e),
        auditor_id: 7,
        finalization_grace_ledgers: shared::types::FINALIZATION_GRACE_LEDGERS,
    };
    platform.finalization_grace_ledgers = shared::types::MIN_FINALIZATION_GRACE_LEDGERS - 1;
    e.register(
        Factory,
        (
            Address::generate(&e),
            BytesN::from_array(&e, &[0u8; 32]),
            platform,
        ),
    );
}

#[test]
fn each_market_freezes_the_platform_grace_at_creation() {
    let w = new_world();
    let mut short = w.platform.clone();
    short.finalization_grace_ledgers = 60;
    try_set_platform(&w, &short).unwrap();
    let (_, first) = w.create(&w.params());
    assert_eq!(w.market_of(&first).finalization_grace_ledgers, 60);

    let mut long = w.platform.clone();
    long.finalization_grace_ledgers = 120;
    try_set_platform(&w, &long).unwrap();
    let (_, second) = w.create(&w.params());
    assert_eq!(w.market_of(&second).finalization_grace_ledgers, 120);
    assert_eq!(w.market_of(&first).finalization_grace_ledgers, 60);
}
