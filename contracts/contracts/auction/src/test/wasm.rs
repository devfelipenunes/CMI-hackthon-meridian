use soroban_sdk::{vec, Address, Bytes, Env, IntoVal, Symbol};

const ULTRAHONK_VERIFIER: &[u8] = include_bytes!("../../../../wasm/ultrahonk_verifier.wasm");

const POC_VK: &[u8] = include_bytes!("../../../../wasm/fixtures/set_spender.vk.bin");

const POC_PROOF: &[u8] = include_bytes!("../../../../wasm/fixtures/set_spender.proof.bin");
const POC_PUBLIC_INPUTS: &[u8] =
    include_bytes!("../../../../wasm/fixtures/set_spender.public_inputs.bin");

#[soroban_sdk::contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum VerifierError {
    VkParseError = 1,
    ProofParseError = 2,
    VerificationFailed = 3,
    VkNotSet = 4,
}

#[test]
fn ultrahonk_verifier_wasm_registers_with_vk() {
    let e = Env::default();
    let verifier = register_verifier(&e, POC_VK);

    assert_eq!(
        verify_proof(&e, &verifier, &[], &[]),
        Err(VerifierError::ProofParseError)
    );
}

#[test]
fn ultrahonk_verifier_accepts_poc_proof() {
    let e = Env::default();
    let verifier = register_verifier(&e, POC_VK);

    assert_eq!(
        verify_proof(&e, &verifier, POC_PUBLIC_INPUTS, POC_PROOF),
        Ok(())
    );
}

#[test]
fn ultrahonk_verifier_rejects_tampered_proof() {
    let e = Env::default();
    let verifier = register_verifier(&e, POC_VK);

    let mut tampered = [0u8; POC_PROOF.len()];
    tampered.copy_from_slice(POC_PROOF);
    tampered[5000] ^= 0xff;

    assert_eq!(
        verify_proof(&e, &verifier, POC_PUBLIC_INPUTS, &tampered),
        Err(VerifierError::VerificationFailed)
    );
}

#[test]
fn verify_proof_cost_is_recorded() {
    let e = Env::default();
    let verifier = register_verifier(&e, POC_VK);

    let mut budget = e.cost_estimate().budget();
    budget.reset_unlimited();
    assert_eq!(
        verify_proof(&e, &verifier, POC_PUBLIC_INPUTS, POC_PROOF),
        Ok(())
    );
    let cpu = budget.cpu_instruction_cost();

    std::println!("verify_proof of a real UltraHonk proof: {cpu} CPU instructions");

    assert!(cpu > 0);
    assert!(
        cpu < 100_000_000,
        "verify_proof exceeded the per-transaction cap: {cpu}"
    );
}

fn register_verifier(e: &Env, vk: &[u8]) -> Address {
    e.register(ULTRAHONK_VERIFIER, (Bytes::from_slice(e, vk),))
}

fn verify_proof(
    e: &Env,
    verifier: &Address,
    public_inputs: &[u8],
    proof: &[u8],
) -> Result<(), VerifierError> {
    let args = vec![
        e,
        Bytes::from_slice(e, public_inputs).into_val(e),
        Bytes::from_slice(e, proof).into_val(e),
    ];

    match e.try_invoke_contract::<(), VerifierError>(
        verifier,
        &Symbol::new(e, "verify_proof"),
        args,
    ) {
        Ok(Ok(())) => Ok(()),

        Ok(Err(_)) => panic!("the contract return did not convert"),
        Err(Ok(err)) => Err(err),
        Err(Err(_)) => panic!("the call did not reach the contract"),
    }
}
