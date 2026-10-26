use soroban_sdk::xdr::FromXdr;
use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, BytesN, Env, Vec};

use crate::external::{SpenderDelegation, SpenderTransferData};

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
    Delegation(Address, Address),

    DelegationRevoked(Address, Address),

    Transfers,

    FailAt,

    OpenAccount(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransferCall {
    pub spender: Address,
    pub from: Address,
    pub to: Address,
    pub data: Bytes,
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

    pub fn registered_count(e: Env) -> u32 {
        let accounts: Vec<Address> = e
            .storage()
            .instance()
            .get(&FakeTokenKey::Accounts)
            .unwrap_or(Vec::new(&e));
        accounts.len()
    }

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

    pub fn set_delegation_expiry(
        e: Env,
        account: Address,
        spender: Address,
        live_until_ledger: u32,
    ) {
        let mut delegation = read(&e, &account, &spender);
        delegation.live_until_ledger = live_until_ledger;
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

        if SpenderTransferData::from_xdr(&e, &data).is_err() {
            panic!("InvalidData");
        }
        if !is_registered(&e, &to, &from) {
            panic!("AccountNotRegistered");
        }

        let storage = e.storage().instance();
        let mut transfers: Vec<TransferCall> = storage
            .get(&FakeTokenKey::Transfers)
            .unwrap_or(Vec::new(&e));
        let index = transfers.len();
        transfers.push_back(TransferCall {
            spender,
            from,
            to,
            data,
        });
        storage.set(&FakeTokenKey::Transfers, &transfers);

        if storage.get(&FakeTokenKey::FailAt) == Some(index) {
            panic!("FakeConfidentialToken was told to refuse on leg {index}");
        }
    }

    pub fn open_account(e: Env, account: Address) {
        e.storage()
            .instance()
            .set(&FakeTokenKey::OpenAccount(account), &());
    }

    pub fn close_account(e: Env, account: Address) {
        e.storage()
            .instance()
            .remove(&FakeTokenKey::OpenAccount(account));
    }

    pub fn transfers(e: Env) -> Vec<TransferCall> {
        e.storage()
            .instance()
            .get(&FakeTokenKey::Transfers)
            .unwrap_or(Vec::new(&e))
    }

    pub fn set_fail_at(e: Env, at: Option<u32>) {
        let storage = e.storage().instance();
        match at {
            Some(at) => storage.set(&FakeTokenKey::FailAt, &at),
            None => storage.remove(&FakeTokenKey::FailAt),
        }
    }
}

fn is_registered(e: &Env, to: &Address, from: &Address) -> bool {
    let storage = e.storage().instance();
    to == from
        || storage.has(&FakeTokenKey::Registration(to.clone()))
        || storage.has(&FakeTokenKey::OpenAccount(to.clone()))
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

fn read(e: &Env, account: &Address, spender: &Address) -> SpenderDelegation {
    delegation(e, account, spender).expect("DelegationNotFound")
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FakeVerifierKey {
    Accept,
    Inputs,
    Proof,
}

#[contract]
pub struct FakeVerifier;

#[contractimpl]
impl FakeVerifier {
    pub fn set_accept(e: Env, accept: bool) {
        e.storage()
            .instance()
            .set(&FakeVerifierKey::Accept, &accept);
    }

    pub fn verify_proof(e: Env, public_inputs: Bytes, proof_bytes: Bytes) {
        let storage = e.storage().instance();
        storage.set(&FakeVerifierKey::Inputs, &public_inputs);
        storage.set(&FakeVerifierKey::Proof, &proof_bytes);

        if !storage.get(&FakeVerifierKey::Accept).unwrap_or(true) {
            panic!("FakeVerifier was told to refuse");
        }
    }

    pub fn last_inputs(e: Env) -> Bytes {
        e.storage()
            .instance()
            .get(&FakeVerifierKey::Inputs)
            .unwrap_or(Bytes::new(&e))
    }

    pub fn last_proof(e: Env) -> Bytes {
        e.storage()
            .instance()
            .get(&FakeVerifierKey::Proof)
            .unwrap_or(Bytes::new(&e))
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum FakePolicyKey {
    Allow,
}

#[contract]
pub struct FakePolicy;

#[contractimpl]
impl FakePolicy {
    pub fn set_allow(e: Env, allow: bool) {
        e.storage().instance().set(&FakePolicyKey::Allow, &allow);
    }

    pub fn is_eligible(e: Env, _participant: Address, _market_id: u64) -> bool {
        e.storage()
            .instance()
            .get(&FakePolicyKey::Allow)
            .unwrap_or(false)
    }
}
