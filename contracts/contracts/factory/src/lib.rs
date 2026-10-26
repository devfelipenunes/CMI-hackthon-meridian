#![no_std]

use shared::config::validate_params;
use shared::types::{
    ConfigError, MarketParams, PlatformConfig, FINALIZATION_GRACE_LEDGERS, MAX_DURATION_LEDGERS,
    MAX_FINALIZATION_GRACE_LEDGERS, MIN_FINALIZATION_GRACE_LEDGERS, SETTLEMENT_MARGIN_LEDGERS,
    TTL_BUFFER_LEDGERS,
};
use soroban_sdk::token::TokenClient;
use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    panic_with_error, Address, Bytes, BytesN, Env, Val,
};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketCreated {
    #[topic]
    pub market_id: u64,
    pub auction: Address,
    pub seller: Address,
}

pub const FIRST_MARKET_ID: u64 = 1;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    AuctionWasm,
    Platform,
    NextMarketId,
    Market(u64),
}

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum FactoryError {
    MarketNotFound = 1,

    MarketIdOverflow = 2,
    InvalidTotalQuotas = 3,
    InvalidMinPrice = 4,
    InvalidCloseLedger = 5,
    DurationTooLong = 6,
    InvalidFeeReserve = 7,

    SellerNotRegistered = 8,

    FeeWalletNotRegistered = 9,

    InvalidFinalizationGrace = 10,
}

#[contractclient(name = "ConfidentialTokenClient")]
pub trait ConfidentialTokenAccounts {
    fn confidential_balance(e: Env, account: Address) -> Val;
}

fn is_registered(e: &Env, token: &Address, account: &Address) -> bool {
    ConfidentialTokenClient::new(e, token)
        .try_confidential_balance(account)
        .is_ok()
}

fn factory_error(err: ConfigError) -> FactoryError {
    match err {
        ConfigError::TotalQuotas => FactoryError::InvalidTotalQuotas,
        ConfigError::MinPrice => FactoryError::InvalidMinPrice,
        ConfigError::CloseLedger => FactoryError::InvalidCloseLedger,
        ConfigError::DurationTooLong => FactoryError::DurationTooLong,
        ConfigError::FeeReserve => FactoryError::InvalidFeeReserve,
    }
}

#[contract]
pub struct Factory;

#[contractimpl]
impl Factory {
    pub fn __constructor(
        e: Env,
        admin: Address,
        auction_wasm_hash: BytesN<32>,
        platform: PlatformConfig,
    ) {
        validate_platform(&e, &platform);
        let storage = e.storage().instance();
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::AuctionWasm, &auction_wasm_hash);
        storage.set(&DataKey::Platform, &platform);
        extend_instance_ttl(&e);
    }

    pub fn create_market(
        e: Env,
        seller: Address,
        params: MarketParams,
        register_data: Bytes,
    ) -> (u64, Address) {
        seller.require_auth();

        if let Err(err) = validate_params(&e, &params) {
            panic_with_error!(&e, factory_error(err));
        }

        let platform = read_platform(&e);

        if !is_registered(&e, &platform.collateral_token, &seller) {
            panic_with_error!(&e, FactoryError::SellerNotRegistered);
        }
        if !is_registered(&e, &platform.collateral_token, &platform.fee_wallet) {
            panic_with_error!(&e, FactoryError::FeeWalletNotRegistered);
        }

        let market_id = allocate_market_id(&e);
        let wasm_hash = read_auction_wasm(&e);

        let auction = e
            .deployer()
            .with_current_contract(salt_for(&e, market_id))
            .deploy_v2(
                wasm_hash,
                (
                    market_id,
                    seller.clone(),
                    params.clone(),
                    platform.clone(),
                    register_data,
                ),
            );

        TokenClient::new(&e, &platform.fee_asset).transfer(&seller, &auction, &params.fee_reserve);

        let registry_key = DataKey::Market(market_id);
        e.storage().persistent().set(&registry_key, &auction);

        let market_ttl = (params.close_ledger
            + FINALIZATION_GRACE_LEDGERS
            + SETTLEMENT_MARGIN_LEDGERS
            + TTL_BUFFER_LEDGERS)
            .saturating_sub(e.ledger().sequence())
            .max(TTL_BUFFER_LEDGERS);
        e.storage()
            .persistent()
            .extend_ttl(&registry_key, market_ttl, market_ttl);
        extend_instance_ttl(&e);

        MarketCreated {
            market_id,
            auction: auction.clone(),
            seller,
        }
        .publish(&e);

        (market_id, auction)
    }

    pub fn predict_market_address(e: Env, market_id: u64) -> Address {
        e.deployer()
            .with_current_contract(salt_for(&e, market_id))
            .deployed_address()
    }

    pub fn next_market_id(e: Env) -> u64 {
        read_next_market_id(&e)
    }

    pub fn get_market_address(e: Env, market_id: u64) -> Address {
        read_market_address(&e, market_id)
    }

    pub fn get_platform_config(e: Env) -> PlatformConfig {
        read_platform(&e)
    }

    pub fn set_auction_wasm(e: Env, wasm_hash: BytesN<32>) {
        read_admin(&e).require_auth();
        e.storage()
            .instance()
            .set(&DataKey::AuctionWasm, &wasm_hash);
        extend_instance_ttl(&e);
    }

    pub fn set_platform_config(e: Env, platform: PlatformConfig) {
        read_admin(&e).require_auth();
        validate_platform(&e, &platform);
        e.storage().instance().set(&DataKey::Platform, &platform);
        extend_instance_ttl(&e);
    }
}

const INSTANCE_TTL_LEDGERS: u32 = MAX_DURATION_LEDGERS
    + FINALIZATION_GRACE_LEDGERS
    + SETTLEMENT_MARGIN_LEDGERS
    + TTL_BUFFER_LEDGERS;

fn extend_instance_ttl(e: &Env) {
    e.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_LEDGERS, INSTANCE_TTL_LEDGERS);
}

fn salt_for(e: &Env, market_id: u64) -> BytesN<32> {
    let mut salt = [0u8; 32];
    salt[24..32].copy_from_slice(&market_id.to_be_bytes());
    BytesN::from_array(e, &salt)
}

fn read_admin(e: &Env) -> Address {
    e.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic_with_error!(e, FactoryError::MarketNotFound))
}

fn validate_platform(e: &Env, platform: &PlatformConfig) {
    let grace = platform.finalization_grace_ledgers;
    if !(MIN_FINALIZATION_GRACE_LEDGERS..=MAX_FINALIZATION_GRACE_LEDGERS).contains(&grace) {
        panic_with_error!(e, FactoryError::InvalidFinalizationGrace);
    }
}

fn read_platform(e: &Env) -> PlatformConfig {
    e.storage()
        .instance()
        .get(&DataKey::Platform)
        .unwrap_or_else(|| panic_with_error!(e, FactoryError::MarketNotFound))
}

fn read_auction_wasm(e: &Env) -> BytesN<32> {
    e.storage()
        .instance()
        .get(&DataKey::AuctionWasm)
        .unwrap_or_else(|| panic_with_error!(e, FactoryError::MarketNotFound))
}

pub(crate) fn read_next_market_id(e: &Env) -> u64 {
    e.storage()
        .instance()
        .get(&DataKey::NextMarketId)
        .unwrap_or(FIRST_MARKET_ID)
}

pub(crate) fn read_market_address(e: &Env, market_id: u64) -> Address {
    e.storage()
        .persistent()
        .get(&DataKey::Market(market_id))
        .unwrap_or_else(|| panic_with_error!(e, FactoryError::MarketNotFound))
}

pub(crate) fn allocate_market_id(e: &Env) -> u64 {
    let id = read_next_market_id(e);
    let next = id
        .checked_add(1)
        .unwrap_or_else(|| panic_with_error!(e, FactoryError::MarketIdOverflow));

    e.storage().instance().set(&DataKey::NextMarketId, &next);
    id
}

#[cfg(test)]
mod test;
