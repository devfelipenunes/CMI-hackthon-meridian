mod deploy;

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, IntoVal, Symbol, Vec};

use shared::types::PlatformConfig;

use crate::{
    allocate_market_id, read_market_address, read_next_market_id, DataKey, Factory, FactoryError,
    FIRST_MARKET_ID,
};

#[contract]
pub struct FactoryHarness;

#[contractimpl]
impl FactoryHarness {
    pub fn allocate(e: Env) -> u64 {
        allocate_market_id(&e)
    }

    pub fn next_market_id(e: Env) -> u64 {
        read_next_market_id(&e)
    }

    pub fn set_next_market_id(e: Env, id: u64) {
        e.storage().instance().set(&DataKey::NextMarketId, &id);
    }

    pub fn get_market_address(e: Env, market_id: u64) -> Address {
        read_market_address(&e, market_id)
    }

    pub fn set_market_address(e: Env, market_id: u64, auction: Address) {
        e.storage()
            .persistent()
            .set(&DataKey::Market(market_id), &auction);
    }
}

fn platform(e: &Env) -> PlatformConfig {
    PlatformConfig {
        collateral_token: Address::generate(e),
        fee_asset: Address::generate(e),
        bid_verifier: Address::generate(e),
        allocation_verifier: Address::generate(e),
        settlement_verifier: Address::generate(e),
        fee_wallet: Address::generate(e),
        auditor_id: 7,
        finalization_grace_ledgers: shared::types::FINALIZATION_GRACE_LEDGERS,
    }
}

fn deploy(e: &Env) -> (Address, PlatformConfig) {
    let platform = platform(e);
    let admin = Address::generate(e);
    let auction_wasm = BytesN::from_array(e, &[0u8; 32]);

    let factory = e.register(Factory, (admin, auction_wasm, platform.clone()));
    (factory, platform)
}

fn harness(e: &Env) -> Address {
    e.register(FactoryHarness, ())
}

fn allocate(e: &Env, addr: &Address) -> Result<u64, FactoryError> {
    match e.try_invoke_contract::<u64, FactoryError>(addr, &Symbol::new(e, "allocate"), Vec::new(e))
    {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(Ok(err)) => Err(err),
        Err(Err(_)) => panic!("the call did not reach the contract"),
    }
}

fn next_market_id(e: &Env, addr: &Address) -> Result<u64, FactoryError> {
    match e.try_invoke_contract::<u64, FactoryError>(
        addr,
        &Symbol::new(e, "next_market_id"),
        Vec::new(e),
    ) {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(Ok(err)) => Err(err),
        Err(Err(_)) => panic!("the call did not reach the contract"),
    }
}

fn get_market_address(e: &Env, addr: &Address, market_id: u64) -> Result<Address, FactoryError> {
    let args = soroban_sdk::vec![e, market_id.into_val(e)];

    match e.try_invoke_contract::<Address, FactoryError>(
        addr,
        &Symbol::new(e, "get_market_address"),
        args,
    ) {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(Ok(err)) => Err(err),
        Err(Err(_)) => panic!("the call did not reach the contract"),
    }
}

fn get_platform_config(e: &Env, addr: &Address) -> Result<PlatformConfig, FactoryError> {
    match e.try_invoke_contract::<PlatformConfig, FactoryError>(
        addr,
        &Symbol::new(e, "get_platform_config"),
        Vec::new(e),
    ) {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(Ok(err)) => Err(err),
        Err(Err(_)) => panic!("the call did not reach the contract"),
    }
}

fn set_next_market_id(e: &Env, addr: &Address, id: u64) {
    let args = soroban_sdk::vec![e, id.into_val(e)];
    e.invoke_contract::<()>(addr, &Symbol::new(e, "set_next_market_id"), args);
}

fn set_market_address(e: &Env, addr: &Address, market_id: u64, auction: Address) {
    let args = soroban_sdk::vec![e, market_id.into_val(e), auction.into_val(e)];
    e.invoke_contract::<()>(addr, &Symbol::new(e, "set_market_address"), args);
}

#[test]
fn factory_registers_in_env() {
    let e = Env::default();

    let _ = deploy(&e);
}

#[test]
fn first_market_id_is_1() {
    let e = Env::default();

    let (factory, _) = deploy(&e);
    assert_eq!(next_market_id(&e, &factory), Ok(FIRST_MARKET_ID));
    assert_eq!(FIRST_MARKET_ID, 1);

    let h = harness(&e);
    assert_eq!(allocate(&e, &h), Ok(1));
}

#[test]
fn ids_are_sequential_and_unique() {
    let e = Env::default();
    let h = harness(&e);

    let mut ids = [0u64; 5];
    for slot in ids.iter_mut() {
        *slot = allocate(&e, &h).unwrap();
    }
    assert_eq!(ids, [1, 2, 3, 4, 5]);

    let mut seen = [0u64; 5];
    for (i, id) in ids.iter().enumerate() {
        assert!(!seen[..i].contains(id), "id {id} was allocated twice");
        seen[i] = *id;
    }
}

#[test]
fn id_overflow_fails_with_market_id_overflow() {
    let e = Env::default();
    let h = harness(&e);

    set_next_market_id(&e, &h, u64::MAX - 1);
    assert_eq!(allocate(&e, &h), Ok(u64::MAX - 1));
    assert_eq!(next_market_id(&e, &h), Ok(u64::MAX));

    assert_eq!(allocate(&e, &h), Err(FactoryError::MarketIdOverflow));
    assert_eq!(
        next_market_id(&e, &h),
        Ok(u64::MAX),
        "the allocation that failed must not have advanced the counter"
    );
}

#[test]
fn get_market_address_resolves_a_known_id() {
    let e = Env::default();
    let h = harness(&e);
    let auction = Address::generate(&e);

    set_market_address(&e, &h, 7, auction.clone());

    assert_eq!(get_market_address(&e, &h, 7), Ok(auction));
    assert_eq!(
        get_market_address(&e, &h, 8),
        Err(FactoryError::MarketNotFound)
    );
}

#[test]
fn get_market_address_unknown_fails_with_market_not_found() {
    let e = Env::default();
    let (factory, _) = deploy(&e);

    assert_eq!(
        get_market_address(&e, &factory, 0),
        Err(FactoryError::MarketNotFound)
    );
    assert_eq!(
        get_market_address(&e, &factory, 42),
        Err(FactoryError::MarketNotFound)
    );
    assert_eq!(
        get_market_address(&e, &factory, u64::MAX),
        Err(FactoryError::MarketNotFound)
    );
}

#[test]
fn platform_config_is_stored() {
    let e = Env::default();
    let (factory, expected) = deploy(&e);

    assert_eq!(get_platform_config(&e, &factory), Ok(expected));
}
