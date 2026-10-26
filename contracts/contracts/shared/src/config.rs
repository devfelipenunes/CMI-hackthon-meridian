use soroban_sdk::Env;

use crate::types::{ConfigError, MarketParams, MAX_DURATION_LEDGERS, MIN_FEE_RESERVE};

pub fn validate_params(e: &Env, params: &MarketParams) -> Result<(), ConfigError> {
    if params.total_quotas == 0 {
        return Err(ConfigError::TotalQuotas);
    }

    if params.min_price_per_quota == 0 || params.min_price_per_quota >= 1u64 << 63 {
        return Err(ConfigError::MinPrice);
    }

    let now = e.ledger().sequence();
    if params.close_ledger <= now {
        return Err(ConfigError::CloseLedger);
    }

    if params.close_ledger - now > MAX_DURATION_LEDGERS {
        return Err(ConfigError::DurationTooLong);
    }

    if params.fee_reserve < MIN_FEE_RESERVE {
        return Err(ConfigError::FeeReserve);
    }

    Ok(())
}
