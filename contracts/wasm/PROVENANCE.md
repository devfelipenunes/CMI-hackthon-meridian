# WASMs — provenance

The first four are **third-party** artifacts, versioned on purpose: the contract does not copy
their source code, it only loads them. The sha256 are checked by
[`scripts/check-wasm.sh`](../scripts/check-wasm.sh), which also covers the six VKs in `vks/`.

| File | Bytes | sha256 |
|---|---|---|
| `ultrahonk_verifier.wasm` | 18307 | `7ec8c9e50a1a2862652074bcd6df6b46e17180253c95da981db72e28e93b8e70` |
| `confidential_token.wasm` | 43752 | `74b6978c0519e6a1807f54a9677c47555a7f696a3d336603a79b63773f4fb6d8` |
| `confidential_verifier.wasm` | 37533 | `0ececaae8cbd3c78f19d9057d80a73799b35468074081dc2d92bebe91b2e3552` |
| `confidential_auditor.wasm` | 19503 | `43303f4421d2bab6020f8a82312f09533c3612509677a646792b9c82cb31d05f` |

## `ultrahonk_verifier.wasm`

- **Repository:** <https://github.com/NethermindEth/rs-soroban-ultrahonk>
- **Commit:** `34a18dae9f6f42dbfb589dccb229cf28912ecacc`
- **Build** (repository root at that commit, with no source modification):
  `stellar contract build --manifest-path contracts/rs-soroban-ultrahonk/Cargo.toml`
- **License:** Apache-2.0
- **Interface:** `__constructor(vk_bytes)`, `verify_proof(public_inputs, proof_bytes)`;
  errors `VkParseError = 1`, `ProofParseError = 2`, `VerificationFailed = 3`, `VkNotSet = 4`.
- **Format:** 1760-byte VK (32 header + 27 G1 points of 64); 14592-byte proof
  (456 fields × 32).
- **Why this commit:** HEAD pins `soroban-sdk = "28.0.0"` and the host here is
  `soroban-env-host 26.1.4`, which rejects the binary (`contract protocol number is newer than
  host`). The repository does not publish tags, and `34a18dae9f` is the last commit on SDK 26.

## `confidential_token.wasm`, `confidential_verifier.wasm`, `confidential_auditor.wasm`

- **Repository:** <https://github.com/brozorec/stellar-confidential-token-demo>
- **Commit:** `9500ed774b13b08b5fe99370b60de3479edb492b`
- **Path:** `packages/sdk/contracts/` — artifacts already versioned there, not recompiled here.
- **Origin:** byte-identical to OpenZeppelin `stellar-contracts` @ `539968f` (the demo's
  `Cargo.lock` pins that commit); it is what POC-5 already checks on the network.
- **License:** Apache-2.0
- **Interfaces:** token `__constructor(underlying_asset, verifier, auditor)`, `set_spender`,
  `revoke_spender`, `is_spender`, `confidential_transfer(_from)`, `deposit`, `withdraw`,
  `register`; verifier and auditor `__constructor(admin, manager)` + RBAC.

## `auction.wasm` — ours, not pinned

The four above are third-party and change when upstream changes. This one is the opposite: it
is the WASM of `contracts/auction`, which **we** compile, and it changes at every step.

- **Who generates it:** `./scripts/build.sh` (the `stellar contract build` followed by the copy).
- **Why it is in git:** the deploy test of step 1.3
  (`contracts/factory/src/test/deploy.rs`) loads it with `include_bytes!`. The test host's
  `deploy_v2` only accepts a hash that came from `upload_contract_wasm`, which needs the real
  bytes; `Env::register` registers the native contract and produces no hash at all. The bytes
  have to exist before `cargo test`, and the repository has no CI that builds them.
- **Why it is not in `check-wasm.sh`:** the four third-party ones are pinned by sha256
  precisely because they *must not* change. This one changes at every step; pinning it would
  force editing the script on every commit. What protects against it going stale is the test
  itself: an outdated binary fails when decoding the constructor arguments.
- **Check:** the sha256 of the current build is at the end of the `wasm/auction.wasm` diff. It
  does **not** go into `artifacts/SHA256SUMS`, which belongs to the release (step 5.x).

## `vks/` — the six Confidential Token VKs

They are what step 3.3 registers inside the `confidential_verifier` at deploy. They are
versioned for the same reason as the WASMs above: a VK is what decides **which** proofs the
token accepts, and swapping one for another makes the token accept a forged proof. They are
not our artifact — the VKs that our own circuit generates live in `artifacts/vks/`, covered by
`scripts/circuits.sh`.

| File | Bytes | sha256 |
|---|---|---|
| `register.vk.bin` | 1760 | `79a2f5f78e0466d711745c3e0ab0d974065ed5f6abcda3cebb80d5e5d4a839b0` |
| `withdraw.vk.bin` | 1760 | `7c9e5e55409617123e6a48cd8e92b10f6f71d2bb00f23b11115307d396098d19` |
| `transfer.vk.bin` | 1760 | `7d3de3ce979e3f42d44afdfd4e90774ad540d75920c66939cb2cebaad9bd373d` |
| `spender_transfer.vk.bin` | 1760 | `22e42d3b9dfc38fa22c22c9335e37a47e756d895ed3b0226fece38ce46277e6c` |
| `set_spender.vk.bin` | 1760 | `fc0bf2fd65b036d1e838e641eafae46b01e9f45bcc433a33e7d0eac433ab3dbe` |
| `revoke_spender.vk.bin` | 1760 | `e5e5bc6c0b12d828d3b3258b73ccfdda26cfbc4b0fa1a3ccb3ffb73ed7bd1f73` |

**Provenance.** The six files come from `packages/sdk/circuits/vks/` of the demo
(`brozorec/stellar-confidential-token-demo` @ `9500ed774b13b08b5fe99370b60de3479edb492b`, the
same commit as the three token WASMs above), and were confirmed **byte by byte** against the VKs
registered in the demo verifier **on testnet**
(`CDCET36PIS44DWJM5UQSSI4ZHGRDSBIIQW4G4ALPYK3Y6FEQGY5ZWFXL`), read one by one with
`get_verification_key --circuit_type 0..5`:

```bash
for n in 0 1 2 3 4 5; do
  stellar contract invoke --id CDCET36PIS44DWJM5UQSSI4ZHGRDSBIIQW4G4ALPYK3Y6FEQGY5ZWFXL \
    --network testnet --source <qualquer> --send no -- get_verification_key --circuit_type "$n"
done
```

`--send no` is simulation: it does not send a transaction, and needs no key or balance. It is a read.

The `circuit_type` matches the file name: `0 register`, `1 withdraw`, `2 transfer`,
`3 spender_transfer`, `4 set_spender`, `5 revoke_spender` (it is the order of `CIRCUIT_TYPE` in
the demo SDK, and the one `scripts/deploy-testnet.sh` uses when registering).

POC-5 versions three of those six in `circuits/vks/`, in two variants: `.local.vk.bin`
(derived with `bb write_vk`) and `.onchain.vk.bin` (read from the live verifier). There the two
are byte-identical — the distinction is one of provenance, not content — and that is why the
check above does not depend on which of the two is used.

## `fixtures/` — test inputs
They are not WASMs; they exist only to exercise the verifier. `check-wasm.sh` does not check them.

| File | Bytes | sha256 |
|---|---|---|
| `set_spender.vk.bin` | 1760 | `fc0bf2fd65b036d1e838e641eafae46b01e9f45bcc433a33e7d0eac433ab3dbe` |
| `set_spender.proof.bin` | 14592 | `0074583b78ee65111ea8979c992a13c3117fc3426013958d1a8bcc9362963085` |
| `set_spender.public_inputs.bin` | 768 | `d691232b8bb6ced410b1f5dfb99c71cf97a797ac8926a190ad425a6094046278` |

- **VK:** `specs/POC/poc-5-live-confidential-token/circuits/vks/set_spender.onchain.vk.bin`.
- **Proof and public inputs:** no POC versions a proof, so they were generated here, from the
  circuit recompiled from the OpenZeppelin `stellar-contracts` source @
  `539968f158e0d779f584de2821090f715a3b25e1`
  (`packages/tokens/src/confidential/circuits/set_spender/`), with the witness transcribed from
  the upstream's `src/tests.nr`. The VK derived from that circuit matches the POC-5 one byte by
  byte.
- **Oracle hash:** proof, VK and verifier must agree on `keccak`
  (`bb prove/verify --scheme ultra_honk --oracle_hash keccak`). With another one, the proof does
  not verify against this VK.
