use shared::types::{MarketParams, PlatformConfig, MIN_FEE_RESERVE};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{Address, Bytes, Env};

use crate::test::fakes::{FakeConfidentialToken, FakePolicy, FakeVerifier};
use crate::Auction;

const START_LEDGER: u32 = 1_000_000;

const MARKET_ID: u64 = 1;

const REGISTER_DATA: [u8; 3] = [1, 2, 3];

pub struct World {
    pub e: Env,
    pub auction: Address,
    pub seller: Address,
    pub quota_asset: Address,
    pub fee_asset: Address,
}

pub fn new_world() -> World {
    build(None)
}

pub fn new_world_with_policy() -> World {
    build(Some(Scenario::DenyPolicy))
}

enum Scenario {
    DenyPolicy,
}

fn build(scenario: Option<Scenario>) -> World {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().with_mut(|li| li.sequence_number = START_LEDGER);

    let admin = Address::generate(&e);
    let seller = Address::generate(&e);

    let token = e.register(FakeConfidentialToken, ());
    let fee_asset = e
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let quota_asset = e.register_stellar_asset_contract_v2(admin).address();

    let bid_verifier = e.register(FakeVerifier, ());
    let allocation_verifier = e.register(FakeVerifier, ());
    let settlement_verifier = e.register(FakeVerifier, ());
    let fee_wallet = Address::generate(&e);

    let platform = PlatformConfig {
        collateral_token: token.clone(),
        fee_asset: fee_asset.clone(),

        bid_verifier,
        allocation_verifier,
        settlement_verifier,
        fee_wallet: fee_wallet.clone(),
        auditor_id: 7,
        finalization_grace_ledgers: shared::types::FINALIZATION_GRACE_LEDGERS,
    };

    let params = MarketParams {
        quota_asset: quota_asset.clone(),
        total_quotas: 10,
        min_price_per_quota: 100,
        close_ledger: START_LEDGER + 1_000,
        eligibility_policy: scenario.map(|_| e.register(FakePolicy, ())),
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

    for account in [&seller, &fee_wallet] {
        e.invoke_contract::<()>(
            &token,
            &soroban_sdk::Symbol::new(&e, "open_account"),
            soroban_sdk::vec![&e, soroban_sdk::IntoVal::into_val(account, &e)],
        );
    }

    StellarAssetClient::new(&e, &fee_asset).mint(&seller, &MIN_FEE_RESERVE);
    TokenClient::new(&e, &fee_asset).transfer(&seller, &auction, &MIN_FEE_RESERVE);

    World {
        e,
        auction,
        seller,
        quota_asset,
        fee_asset,
    }
}

impl World {
    pub fn fund(&self, to: &Address, amount: i128) {
        StellarAssetClient::new(&self.e, &self.quota_asset).mint(to, &amount);
    }
}
