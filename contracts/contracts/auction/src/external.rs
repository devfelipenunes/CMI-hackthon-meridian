use soroban_sdk::token::TokenClient;
use soroban_sdk::xdr::FromXdr;
use soroban_sdk::{contractclient, contracttype, panic_with_error, Address, Bytes, BytesN, Env};

use crate::types::{AuctionError, MarketConfig};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpenderDelegation {
    pub allowance_commitment: BytesN<64>,

    pub encrypted_allowance: BytesN<32>,

    pub escrowed_dvk: BytesN<64>,

    pub allowance_salt: BytesN<32>,

    pub live_until_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpenderTransferPayload {
    pub c_a_new: BytesN<64>,

    pub c_tx: BytesN<64>,

    pub r_e: BytesN<64>,

    pub v_tilde: BytesN<32>,

    pub a_tilde_new: BytesN<32>,

    pub sigma_a_new: BytesN<32>,
    pub v_aud_r: BytesN<32>,
    pub r_aud_r: BytesN<32>,
    pub v_aud_s: BytesN<32>,
    pub a_aud_s: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpenderTransferData {
    pub payload: SpenderTransferPayload,
    pub proof: Bytes,
}

#[contractclient(name = "ConfidentialTokenClient")]
pub trait ConfidentialTokenInterface {
    fn register(e: Env, account: Address, auditor_id: u32, data: Bytes);

    fn is_spender(e: Env, account: Address, spender: Address) -> bool;

    fn get_spender_delegation(e: Env, account: Address, spender: Address) -> SpenderDelegation;

    fn confidential_transfer_from(
        e: Env,
        spender: Address,
        from: Address,
        to: Address,
        data: Bytes,
    );
}

#[contractclient(name = "ProofVerifierClient")]
pub trait ProofVerifierInterface {
    fn verify_proof(e: Env, public_inputs: Bytes, proof_bytes: Bytes);
}

#[contractclient(name = "EligibilityPolicyClient")]
pub trait EligibilityPolicyInterface {
    fn is_eligible(e: Env, participant: Address, market_id: u64) -> bool;
}

pub(crate) fn register(e: &Env, token: &Address, auditor_id: u32, data: &Bytes) {
    let me = e.current_contract_address();
    ConfidentialTokenClient::new(e, token).register(&me, &auditor_id, data);
}

pub(crate) fn is_eligible(e: &Env, config: &MarketConfig, participant: &Address) -> bool {
    match &config.params.eligibility_policy {
        None => true,
        Some(policy) => {
            EligibilityPolicyClient::new(e, policy).is_eligible(participant, &config.market_id)
        }
    }
}

pub(crate) fn has_quota_trustline(e: &Env, quota_asset: &Address, account: &Address) -> bool {
    TokenClient::new(e, quota_asset)
        .try_balance(account)
        .is_ok_and(|converted| converted.is_ok())
}

pub(crate) fn is_spender(e: &Env, token: &Address, bidder: &Address) -> bool {
    let me = e.current_contract_address();
    ConfidentialTokenClient::new(e, token).is_spender(bidder, &me)
}

pub(crate) fn read_delegation(e: &Env, token: &Address, bidder: &Address) -> SpenderDelegation {
    let me = e.current_contract_address();
    ConfidentialTokenClient::new(e, token).get_spender_delegation(bidder, &me)
}

pub(crate) fn verify_bid_proof(
    e: &Env,
    verifier: &Address,
    public_inputs: &Bytes,
    proof: &Bytes,
) -> bool {
    verify_proof(e, verifier, public_inputs, proof)
}

pub(crate) fn verify_allocation_proof(
    e: &Env,
    verifier: &Address,
    public_inputs: &Bytes,
    proof: &Bytes,
) -> bool {
    verify_proof(e, verifier, public_inputs, proof)
}

pub(crate) fn verify_settlement_proof(
    e: &Env,
    verifier: &Address,
    public_inputs: &Bytes,
    proof: &Bytes,
) -> bool {
    verify_proof(e, verifier, public_inputs, proof)
}

pub(crate) fn decode_transfer_data(e: &Env, data: &Bytes) -> BytesN<64> {
    SpenderTransferData::from_xdr(e, data)
        .unwrap_or_else(|_| panic_with_error!(e, AuctionError::InvalidTransferData))
        .payload
        .c_tx
}

pub(crate) fn transfer_from(e: &Env, token: &Address, from: &Address, to: &Address, data: &Bytes) {
    let me = e.current_contract_address();
    ConfidentialTokenClient::new(e, token).confidential_transfer_from(&me, from, to, data);
}

fn verify_proof(e: &Env, verifier: &Address, public_inputs: &Bytes, proof: &Bytes) -> bool {
    ProofVerifierClient::new(e, verifier)
        .try_verify_proof(public_inputs, proof)
        .is_ok_and(|converted| converted.is_ok())
}
