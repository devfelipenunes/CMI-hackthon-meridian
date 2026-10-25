# OPEN QUESTIONS — CMI Auctions

Agents must treat items marked **BLOCKER** as stop conditions.

## OQ-01 — Bid-envelope consistency

RESOLVED — construction chosen, implemented as a Noir circuit, and validated: locally proved/verified, both rejection cases confirmed, and verified on-chain against a real Soroban contract on testnet.

Problem (as originally framed):

Ordinary encryption proves neither:

- that the ciphertext is decryptable later; nor
- that the ciphertext contains the same opening used by the on-chain commitment/proof.

A malicious bidder could otherwise submit a valid commitment/proof plus unusable ciphertext and prevent allocation proving for the whole market, not just their own bid.

**Adopted solution: ECDH-derived envelope masking, proved inside the same circuit that opens the bid commitment.** Built and validated as `POC/poc-2-envelope-consistency`:

```text
1. commitment          == Poseidon2(BID_COMMIT_DOMAIN, price, market_id, participant_id, blinding, nullifier_seed)
2. R                    == r · G                                    (bidder's ephemeral point)
3. S                    == r · PK_operator                          (shared secret, sender side)
4. mask_price           == Poseidon2(BID_ENVELOPE_MASK_DOMAIN, S.x, S.y, 0)
5. mask_blinding        == Poseidon2(BID_ENVELOPE_MASK_DOMAIN, S.x, S.y, 1)
6. mask_seed            == Poseidon2(BID_ENVELOPE_MASK_DOMAIN, S.x, S.y, 2)
7. ciphertext_price     == price + mask_price
8. ciphertext_blinding  == blinding + mask_blinding
9. ciphertext_seed      == nullifier_seed + mask_seed
```

`price`, `blinding`, `nullifier_seed` are the *same* witness variables in constraint 1 and in constraints 7-9 — this is what makes a commitment/envelope divergence structurally unprovable, closing the attack this OQ exists to prevent, not just discouraging it by policy.

Validated (not just designed):

- **ECDH commutativity confirmed empirically**: a dedicated test independently recomputes the shared secret from the recipient side (`sk_operator · R`) and recovers the exact original `price`.
- **Both rejection cases fail at witness-solving** (a stronger guarantee than "the proof verifies false" — no valid proof can even be attempted): a price inconsistent with its own commitment, and — the literal OQ-01 attack — a valid commitment/proof paired with a garbage ciphertext.
- **Verified on real Soroban testnet infrastructure**, not just locally: deployed contract `CAQZ733ICVYAMPAS4WLJRGYUYCTHFV6TSSULG5JLO3GO7P4BX6YM2NAY`, `verify_proof` succeeded (91,051,355 CPU instructions).

See `POC/PLAN.md` (POC-2 section) for the design rationale, `POC/results/SUMMARY.md` for full results, and `ADR-004` (updated) for the frozen decision. This construction still needs to be merged into `bid_validity`'s final constraint set alongside the collateral-linkage constraint (OQ-02) — see `docs/CRYPTO.md`.

Plan: `plans/002-bid-envelope-consistency.md` (design validated; merging into the production `bid_validity` circuit is implementation work, not a remaining open question)

---

## OQ-02 — Confidential collateral linkage

RESOLVED — validated live against the deployed Confidential Token (`POC/poc-5-live-confidential-token`)

Problem:

`bid_validity` must prove that the private bid price, times the bid's public `requested_quantity`, equals the actual confidential amount locked via the Confidential Token's `set_spender` for that participant.

What was resolved, and how:

- **Source:**
  - The function names, partial consumption, and the proof-carrying nature of `set_spender`/`revoke_spender` were confirmed from the pinned source (ADR-018 update).
  - The real `G`/`H` and `commit(v, r) = v·G + r·H` were confirmed from source and independently reproduced (`POC/results/poc-3-generator-confirmation.log`).
- **Live (, POC-5):**
  - **Deployment identity.** The live token, verifier and auditor WASM are byte-identical to artifacts built from OZ `539968f`. All six VKs in the live verifier are byte-identical to the source VKs. The token's `set_spender`/`spender_transfer`/`revoke_spender` circuits, compiled with this project's pinned toolchain, reproduce those VKs exactly.
  - **Real `set_spender`.** A real `set_spender` locked `650 × 200 = 130,000` from a funded, registered bidder to a Soroban contract spender. `get_spender_delegation.allowance_commitment` is the **raw 64-byte `be(x) ‖ be(y)`** of `v_a·G + r_a·H`: two 32-byte big-endian field elements, identity = all zeros. This is exactly the `(x, y)` pair `bid_validity` consumes.
  - **Linkage.** The unmodified POC-3 circuit, fed that **live** `C_a`, proves and verifies both locally and on-chain. A wrong price fails at witness solving.
  - **`r_a` is known to the bidder.** The bidder derives `r_a = Poseidon2(ALLOWANCE_RANDOMNESS, dvk, σ_a)` from their own `vk` and the on-chain `allowance_salt`, so the bidder can always build `bid_validity`.
  - **`live_until_ledger` end to end (PLAN-003 step 7).** Covered, with findings recorded under OQ-11.

Remaining work is implementation, not an open question: merge the POC-2 and POC-3 constraint groups into the single production `bid_validity` circuit (RF-12). The findings that affect settlement and privacy are tracked separately in OQ-06, OQ-11, OQ-13 and OQ-14.

Evidence: `POC/results/SUMMARY.md` (POC-5 section), `POC/results/poc-5-evidence.json`. Plan: `plans/003-collateral-linkage.md`.

---

## OQ-03 — UltraHonk verifier budget

RESOLVED — measured against this project's own circuit-shaped constructions, on real Soroban testnet infrastructure, not a community estimate or a trivial reference circuit

Needed measurements: CPU, memory, proof size, transaction size, fee, public-input overhead, cost scaling as `MAX_BIDS` increases — for constructions shaped like `bid_validity` (the envelope-consistency and collateral-linkage halves, `POC/poc-2` and `POC/poc-3`) and `winner_allocation` (`POC/poc-4`, at the actual production `MAX_BIDS=8`).

**Measured results (Stellar testnet, real transactions, not simulated):**

| Circuit-shaped POC | ACIR opcodes | Gates | Proof size | On-chain CPU instructions | Resource fee |
|---|---|---|---|---|---|
| Toolchain anchor (POC-1) | 37 | 3,931 | 14,592 bytes | 90,386,038 | 130,183 stroops |
| Envelope consistency (POC-2) | 35 | 4,813 | 14,592 bytes | 91,051,355 | 131,485 stroops |
| Collateral linkage, real generators (POC-3) | 44 | 3,103 | 14,592 bytes | 94,575,384 | 132,975 stroops |
| Clearing-price allocation, `MAX_BIDS=8` (POC-4) | 366 | 4,796 | 14,592 bytes | 92,156,131 | 133,515 stroops |

**Headline finding — proof size (14,592 bytes) and on-chain verification cost are essentially flat regardless of circuit complexity**: all four instruction counts land within a 5% band (90.3M–94.6M) despite POC-4 having ~10x POC-3's ACIR opcode count. This confirms, empirically and on real Soroban infrastructure (not just local `bb verify`), that UltraHonk's succinctness holds for this project's own constructions: adding constraints to `bid_validity` or `winner_allocation` does not meaningfully change what a market participant pays to verify a proof on-chain. Local proving time at production scale (`MAX_BIDS=8`) is trivial — a fraction of a second.

**`ADR-013`'s `MAX_BIDS=8` upgrade condition** ("increase only after measured proving and on-chain verification costs remain within targets") **is now satisfied**: both proving time and on-chain verification cost stay small at the current production value.

**Caveat, stated precisely**: POC-2/POC-3 are the two constraint groups that will merge into the *final* `bid_validity` circuit, not that circuit already merged and compiled as one unit — so the exact combined gate count is not yet measured (expected to be roughly additive, well within the same flat verification-cost regime per the finding above). POC-4 already matches `docs/CRYPTO.md`'s `winner_allocation` constraint list at the real `MAX_BIDS=8`, so that number is closer to final. Re-measure once `bid_validity` is actually merged and compiled as a single circuit, before treating its exact number as frozen — but the qualitative finding (flat verification cost) is not expected to change.

See `POC/results/SUMMARY.md` for full detail, on-chain contract IDs/tx hashes, and the `MAX_BIDS=8` benchmark section.

Plan: `plans/001-ultrahonk-spike.md` (toolchain validated, cost anchor established; re-run once `bid_validity` is merged into one circuit)

---

## OQ-04 — Canonical root implementation

RESOLVED: recomputed at close for the MVP, with the future evolution documented in ADR-025.

Decision already fixed conceptually:

- order by `bid_index`;
- fixed `MAX_BIDS`;
- deterministic empty leaves;
- `requested_quantity` tracked as a parallel public array, not inside the leaf (ADR-005 update).

Need implementation choice:

- root recomputed in `close_market()` for small N; or
- incremental tree updated per accepted bid.

**New evidence:** `POC/poc-4-clearing-price-allocation` implemented full recomputation (one Poseidon2 pass over all `MAX_BIDS` leaves inside the `winner_allocation` circuit itself) at the production `MAX_BIDS=8`, and it is cheap — 4,796 gates total for the whole circuit (root reconstruction plus the full allocation logic), proving in well under a second, verifying on-chain at the same flat cost as every other circuit measured (see OQ-03). This is a real data point in favor of "recompute" being simple enough to not need the added complexity of an incremental tree, at this `MAX_BIDS` scale — but it was not a controlled comparison against an incremental-tree implementation, so this OQ is not being marked resolved on that basis alone; it is a leaning, not a decision.

MVP preference: choose the simpler measured implementation — the evidence above supports doing exactly that.

Plan: `plans/004-winner-proof.md`

---

## OQ-05 — Ciphertext storage

RESOLVED: contract storage, per product decision D8 in ADR-024.

Options:

- persistent contract storage;
- event + reliable indexer;
- hybrid redundancy.

Requirement:

The operator must still obtain every accepted envelope needed for allocation proving.

Do not optimize storage at the cost of finalization liveness.

---

## OQ-06 — Confidential settlement API

RESOLVED. The API was confirmed live (POC-5), and the refund path via `confidential_transfer_from(to = bidder)` was adopted in ADR-023 (decision D1). The settlement amount binding is resolved by OQ-13 / POC-6.

Problem:

Need the actual target Confidential Token API and proof/authorization flow, confirmed against the real deployed contract, for:

- locking collateral per bid (`set_spender`);
- transferring exactly `price × filled_quantity` to the seller per winning bid (`confidential_transfer_from`), for potentially many bids in the same market;
- releasing exactly `price × (requested_quantity − filled_quantity)` back to the bidder per bid, including the full amount for a bid filled at zero;
- preserving amount confidentiality throughout, including for the seller's aggregate received total.

Confirmed live against the deployed token (POC-5, a Soroban contract acting as spender):

1. **The spender must be a registered confidential account.** A Soroban contract can be one: it calls `register` from its own constructor, which leaves no front-running window because `register` is first-come. Its spending secret `sk_op` lives off-chain with the platform operator.
2. **`confidential_transfer_from(spender, from, to, data)`** requires `spender.require_auth()`. A contract spender satisfies this only when it is the direct caller: an EOA calling the token directly with a valid proof fails with `failed account authentication`. The accompanying SpenderTransfer proof needs `sk_op`, the delegation's `dvk` (recovered by the spender from `escrowed_dvk` with `sk_op`), and the current allowance (recovered from `encrypted_allowance`). **Anyone can submit the auction contract's settlement call.** Only the holder of `sk_op` can create its proof.
3. **Partial consumption works.** A payment of 78,000 left the delegation at 52,000 with `C_a'` rewritten and the salt rotated. The seller decrypts the amount from the event with its own `vk`.
4. **The refund works without the bidder, through `confidential_transfer_from(to = bidder)`, not through `revoke_spender`.** `revoke_spender` needs the bidder's own `sk` (proof) and signature: a third party submitting a valid bidder proof is refused. The spender-driven refund lands in the bidder's *receiving* balance. The now-empty delegation entry stays until the bidder revokes it, which frees nothing but storage.
5. **Error codes observed live:** `DelegationAlreadyExists` (#3503) for a second lock to the same spender (after proof verification); `DelegationExpired` (#3505) for any spend after `live_until_ledger`.

**Required follow-up (decision, not investigation).**
- ADR-018 ("remainder returns via `revoke_spender`"), ADR-020 and RF-20 must switch the refund leg to `confidential_transfer_from(to = bidder)`; otherwise refunds are not automatic (invariants 8 and 10).
- Every settlement leg carries a proof made with `sk_op`, so the operator must produce a proof per leg. Settlement is permissionless to *submit*, not to *construct*. This needs to be reflected in ADR-020/RF-21.

Plan: `plans/005-confidential-settlement.md`

---

## OQ-07 — External eligibility interfaces

OUT OF MVP (, decision D9 in ADR-024). Documented only.

The MVP ships with eligibility disabled by default (ADR-011 update) — this OQ only matters once/if a policy is enabled. Zolvency and other policy adapters must use verified deployed interfaces. Do not guess signatures. Fallback policy remains available.

Plan: `plans/006-zolvency-adapter.md`

---

## OQ-08 — TTL constants

RESOLVED. Market duration is at most 30 days and the finalization grace is 2 days (decision D7, ADR-024). The settlement margin is fixed at 1 day (≈ 17_280 ledgers) and storage TTLs cover `close_ledger + grace + margin` plus a 1-day buffer, as recorded in the implementing repository (`contracts`) (`docs/DECISIONS.md` D-05) and in ADR-024's derived parameters. Measured constraint for the margin: only one full settlement fits per ledger (ADR-026), so `settlement_margin` must cover at least `MAX_BIDS` ledgers plus retry/automation latency.

Need concrete TTL thresholds based on the Soroban SDK/network target.

Security requirement:

No entry necessary for an active market may expire before the latest possible terminal transition, including the automated per-bid settlement/refund entries introduced by ADR-020.

---

## OQ-09 — Clearing-price / FCFS margin allocation circuit formalization

RESOLVED — formalized as a single accumulator pass, implemented, and validated at production scale

ADR-019 fixes the allocation *rule* (highest price first, FCFS at the exact clearing price); this OQ needed the exact circuit formalization of that rule. **Adopted formalization, no sorting needed** — because `bid_index` is already the FCFS priority order, a single running-accumulator pass in natural order suffices:

```text
for i in 0..MAX_BIDS:
    active    = i < bid_count
    is_above  = active & (prices[i] > clearing_price)
    is_tied   = active & (prices[i] == clearing_price)
    remaining_before_i = total_supply - above_total - tied_used
    tied_fill_i = min(requested_quantities[i], remaining_before_i)
    expected_filled_i = requested_quantities[i] if is_above
                         else tied_fill_i        if is_tied
                         else 0
    assert filled_quantities[i] == expected_filled_i
    above_total += requested_quantities[i] if is_above else 0
    tied_used   += filled_quantities[i]    if is_tied  else 0

assert sum(filled_quantities) == min(total_supply, sum(requested_quantities))
```

Built and validated as `POC/poc-4-clearing-price-allocation`, at the actual production `MAX_BIDS=8` (ADR-013):

- the production-size milestone (8 bids, extending the original 3-bid story) proves and verifies, including a genuine partial fill at the clearing margin *and* a tied bid shut out entirely once the margin is exhausted — both halves of the tie-break rule in one scenario;
- a dedicated tie-break test (two bids exactly tied at the clearing price) confirms the lower `bid_index` wins the contested remainder and the higher index gets zero;
- the undersubscription degenerate case (demand below supply) fills everyone in full using the *same unmodified formula* — the final aggregate check (`sum(filled) == min(total_supply, sum(requested))`) covers it without a special branch;
- wrong allocation and wrong canonical root both fail at witness-solving;
- verified on real Soroban testnet infrastructure: contract `CBDH7HEH3MN6477AH6M2DNWCZHMI7BMU6Y5VTTLLIOMH6WDF3ZHF4RF4`, 92,156,131 CPU instructions.

Note, preserved from the original framing and still true: `clearing_price` itself need not equal any real bid's price. When total supply is exhausted strictly between two distinct bid prices, any witness value in that open interval produces an identical, valid allocation — the circuit above does not require `clearing_price` to match an actual bid price; only the resulting `filled_quantities` are pinned.

See `POC/PLAN.md` (POC-4 section) for the design rationale and `POC/results/SUMMARY.md` for full results. `docs/CRYPTO.md`'s `winner_allocation` section is updated with this formula.

Plan: `plans/004-winner-proof.md` (circuit design validated; production integration into the actual contract is implementation work, not a remaining open question)

---

## OQ-10 — Collateral allowance scoping across concurrent markets

RESOLVED — confirmed against real source and decided. Remaining work is implementing the decision below, not deciding it.

Problem (as originally framed):

The Confidential Token's `set_spender` allowance is scoped to the (owner, spender-contract) pair, not to a specific market or bid. If the Auction Contract is shared across multiple simultaneous markets (the multi-tenant platform model, ADR-021), nothing would prevent the same underlying allowance being referenced by `bid_validity` proofs in two different markets, or a second `set_spender` call silently overwriting/replacing the allowance an already-accepted bid depends on — *if* the token supported either of those.

Resolution, read directly from the pinned source (`OpenZeppelin/stellar-contracts@539968f`, `packages/tokens/src/confidential/storage.rs`):

- `set_spender` reverts with `DelegationAlreadyExists` if a live delegation already exists for that exact `(account, spender)` pair. **It cannot be called twice for the same spender while one delegation is outstanding**, so silent overwriting is not possible — the failure mode is a hard revert, not a security hole.
- The `op_i` value some earlier general research (and an earlier draft of this pack) speculated might be a free index for multiple simultaneous delegations is, in the real contract, computed as `op_i = address_to_field(spender)` — purely a domain-separation input binding the proof to one specific spender address. **It provides no mechanism for a single (account, spender) pair to hold more than one active delegation.**

**Decision:** a single Auction Contract instance cannot safely serve more than one concurrently-open market — this is a hard constraint of the real allowance model, not a design preference. The platform must deploy one Auction Contract (a distinct spender identity) per concurrently-running market. See ADR-018's update section.

Plan: `plans/003-collateral-linkage.md` (implements the one-contract-per-market deployment rule)

---

## OQ-11 — Collateral revocation and delegation expiry after bid acceptance, before settlement

DECIDED (, decision D4 in ADR-024). The quota units of a winning bid that cannot settle return to the seller. Deliberate revocation is accepted as a self-contained risk. The live facts below still apply: RF-09/RF-14 must validate `live_until_ledger`.

Problem, now known to have two distinct causes after reading the real source:

1. **Deliberate revocation.** `revoke_spender` is an owner-authorized operation on the Confidential Token itself — the Auction Contract does not control it, and the real source confirms it works even on an expired delegation ("for both active and expired-but-not-revoked delegations"). A bidder can revoke their own allowance at any time, including after their bid has been accepted into the canonical (immutable) bid set but before settlement executes, causing that specific bid's settlement to fail.
2. **Negligent expiry — newly identified, not present in the original framing of this OQ.** `set_spender` takes an explicit `live_until_ledger`, and `confidential_transfer_from` (the settlement payment call) panics with `DelegationExpired` if the current ledger has passed it. A bidder who sets `live_until_ledger` too short — even with no ill intent — produces the exact same failure mode as (1).

The blast radius for both is self-contained: ADR-020 settles each bid independently, so this cannot block or affect any other participant's settlement. It does mean `docs/PRODUCT.md`'s G4 and `docs/SECURITY.md`'s S10 are snapshot guarantees (true at acceptance time), not continuous ones (not guaranteed through settlement).

**Cause (2) is now mitigated by a concrete rule, not just documented risk:** RF-09/RF-14 must validate `live_until_ledger >= finalize_by_ledger + safety_margin` before accepting a bid, rejecting it at bid submission otherwise (see ADR-018's update, RF-09). This closes the negligent case.

**Cause (1) was decided on  (ADR-024 D4/D13):** it is accepted as a documented, self-contained limitation, and a winning bid that can no longer settle is closed with `release_unsettled`, its quota units returning to the seller. The paths considered at the time are kept below as the record:
- accept this as a documented, self-contained limitation (current posture);
- investigate whether the Confidential Token supports a spender-enforced hold that the allowance owner cannot unilaterally revoke once referenced by an accepted bid (nothing in the source read so far suggests this exists — `revoke_spender` has no such gate);
- a policy-layer mitigation outside the token (e.g., eligibility penalty for a participant who revoked after acceptance), documented in a new ADR if adopted.

Plan: `plans/003-collateral-linkage.md` / `plans/005-confidential-settlement.md`

**Live facts (, POC-5)**, which make cause (2) stricter than the text above assumes:
- The token **accepts `set_spender` with a `live_until_ledger` already in the past.** It does no validation of its own, so the RF-09/RF-14 check is the *only* guard.
- After expiry, **the spender-driven refund fails too** (`DelegationExpired`), not just the payment. Only the bidder's own `revoke_spender` recovers the funds, which it does on expired delegations. A lapsed lock therefore breaks automatic *refunds* as well as payments. The RF-09/RF-14 bound must cover the last possible settlement ledger, including settlement-automation latency.

---

## OQ-12 — Enforcing operator decryption timing

ACCEPTED for the MVP, confirmed by the product owner (decision D6, ADR-024).

Problem:

Nothing in the current design cryptographically prevents the operator's backend from decrypting a bid's envelope before the market closes. This is a different problem from OQ-01: OQ-01 is about whether an accepted envelope's ciphertext is *consistent* with its commitment; this is about *when* the holder of the operator's decryption key is technically capable of using it. Ordinary public-key encryption has no notion of time — whoever holds the private key can decrypt any ciphertext encrypted to it the instant that ciphertext exists, regardless of market state. An operator who wanted to act on early knowledge (for example, informing an ally what the current highest bid is, mid-auction) is not prevented from doing so by anything in this protocol today — only by policy/trust in the platform.

Candidate paths to a real technical guarantee, without assuming one is chosen:

- a TEE/enclave (e.g., AWS Nitro Enclaves, Intel SGX) performing the decryption, attesting that it only released plaintext after independently checking `ledger.sequence() >= close_ledger` — the most practically deployable option today;
- threshold/MPC decryption across independent parties who only cooperate after close — see ADR-003 and `docs/PRODUCT-ROADMAP.md` Phase 3; a materially larger investment, not MVP scope;
- time-lock puzzles / verifiable delay functions — considered and **not recommended**: calibration against real hardware speed is imprecise, and there is no clean way to bind a time-lock to a specific on-chain ledger event.

MVP posture: accept this explicitly as a trust-model limitation (ADR-003), not a cryptographic guarantee. Do not describe "the operator only sees bids after close" as an enforced property anywhere in this pack without this caveat attached.

---

## OQ-13 — Binding the settled amount to the allocation

RESOLVED: validated live in `POC/poc-6-atomic-settlement` and frozen in ADR-023. A settlement-binding proof verified by the Auction Contract binds `c_pay`/`c_refund` to `price × filled` and `price × (requested − filled)`. An overpayment with valid token proofs is rejected on-chain. Extended with the 10% house-fee leg (ADR-026): the fee is bound by the same proof, and skipping or inflating it was rejected on-chain; worst case 348.8M of 400M CPU.

Problem:

The token's SpenderTransfer circuit proves only `0 ≤ v_tx ≤ current allowance`. `v_tx` is a private witness chosen by whoever holds `sk_op`, and the token verifies nothing else about it (`spender_transfer/src/main.nr` O4/O8). The same auction-contract entry points accepted two different operator-chosen amounts live. Without an extra check, the operator could overpay the seller (up to the full collateral) or underpay, which breaks invariants 6, 7 and 9: the operator must not choose the allocation's monetary outcome.

Candidate direction (not chosen): the auction contract decodes `c_tx` from the SpenderTransfer payload (public) and verifies its own **settlement proof** that `c_tx` opens to `price × filled_quantity`, with `price` bound to the bid commitment in the canonical root and `filled_quantity` taken from the verified allocation. The refund leg needs the same treatment against `price × (requested_quantity − filled_quantity)`, or the equivalent condition `C_a' = Com(0, ·)` after both legs. This needs a new circuit, and therefore a new ADR under the guardrails. It is not an implementation detail.

---

## OQ-14 — Who can read `price × requested_quantity` at lock time

DECIDED: accepted and documented (decision D2). In the MVP the auditor is the operator itself, which requires CMI's own token deployment (decision D3, ADR-024).

No price ever appears on-chain in clear text (invariant 1 holds). Two parties can nevertheless decrypt the locked amount, and so the bid price, as soon as `set_spender` lands, before the market closes:

- **The holder of `sk_op` (the platform operator).** The escrowed `dvk` is encrypted to the spender's key by design, so the operator reads `encrypted_allowance`. This is the same party OQ-12 already trusts, but through a channel that exists at lock time regardless of when envelopes are decrypted. A TEE-based decryption-timing control (an OQ-12 path) would also have to hold `sk_op` to cover this.
- **The token's auditor**, whose key is chosen per account at `register`. It decrypts `v_aud_s` from the public `set_spender` event (the escrowed amount) and from each `spender_transfer` event (each payment and refund). In the testnet demo the auditor secret is public, so there anyone can read these values.

This is an accepted MVP trust assumption, documented in PRODUCT, SECURITY and ADR-003. A future token deployment may adopt a different auditor policy.

---

## OQ-15 — Settlement liveness when the operator is offline

POST-MVP (, decision D12 in ADR-024). For the MVP the operator is assumed always online.

Every settlement leg (payment and refund) carries a `SpenderTransfer` proof built with `sk_op`, which only the operator holds (ADR-023). If the operator is unavailable, nobody can build those proofs, including when a market is cancelled for non-finalization (ADR-016). Funds are never trapped: each bidder can always recover their own escrow with `revoke_spender`, which works on active and expired delegations. But the exit becomes manual, and the seller is not paid.

Candidate post-MVP paths (none chosen):
- `sk_op` in an HSM/TEE with a failover operator;
- a threshold-shared `sk_op`;
- a watchdog that notifies bidders to self-revoke once `finalize_by_ledger` passes.

---

## OQ-16 — State-machine path for a winning bid that cannot settle, and for unsold quotas

DECIDED (, ADR-024 D13): the proposal below is adopted. `ARCHITECTURE.md` and RF-07/RF-19/RF-20 are updated. **Extended on ** to `CANCELLED` markets (ADR-024 update): `release_unsettled` is also callable there, so a market cancelled by timeout can end when a bidder revoked before the refund.

ADR-024 D4 decided that the quota units of a winning bid that cannot settle return to the seller. The same holds for units left unsold under undersubscription. Nothing in `ARCHITECTURE.md` implements either:
- a market with one unsettleable bid never reaches `SETTLED`;
- the leftover units have no exit path.

A bid becomes unsettleable when the bidder revoked, or the lock expired.

Proposed (not decided):
- **`release_unsettled(bid_index)`.** Permissionless, callable when the market is `FINALIZED`, the bid is unsettled, and `token.is_spender(bidder, auction) == false`. That condition means revoked or expired, and the contract can read it on-chain. The call sends the bid's `filled_quantity` back to the seller and marks the bid `FAILED`.
- **Unsold units** (`total_quotas − Σ filled`) go back to the seller at `FINALIZED`.
- **`SETTLED`** is reached when every bid is `SETTLED` or `FAILED`.

This adds a state transition, so `ARCHITECTURE.md` must be updated with it (guardrail).

---

## OQ-17 — Governance of CMI's own token / verifier / auditor deployment

DECIDED (, ADR-024 D14): a dedicated operator admin wallet, kept in the backend DB and separate from the operator's other keys. Accepted for the testnet MVP; hardening is post-MVP.

ADR-024 D3 requires CMI to deploy its own Confidential Token set. In that set:
- the verifier's `manager` role can `update_verification_key`, which would let the token accept forged proofs and so move escrowed funds;
- the auditor's `manager` role can `rotate_key`.

Options:
- renounce the admin and manager roles after setup (immutable, no upgrades);
- a multisig;
- a timelocked upgrade process.

---

## OQ-18 — Quota asset specifics

DECIDED (, ADR-024 D18): a trustline is required at bid time, clawback assets are rejected at market creation, and 1 quota = 1 whole unit (10^7 base units).

The quota token in POC-6 is a classic asset exposed through its Stellar Asset Contract (SAC). Consequences:
- **Trustline.** A winning bidder **must have a trustline**. Without one, the quota transfer fails and that bid's whole `settle` reverts. It should be checked at bid time or made a documented bidder requirement.
- **Issuer flags.** If the asset has `AUTH_REQUIRED`, the bidder also needs an authorized trustline. If it has **clawback**, the issuer could claw back escrowed units, which conflicts with invariant 2. The issuer flags should be a market-creation precondition.
- **Decimal scale.** One quota equals one whole unit of the asset (`10^7` base units, seven decimals), per ADR-024 D18.

---

## OQ-19 — How the seller pays settlement fees

DECIDED (, ADR-024 D15): the seller deposits an XLM fee reserve at market creation, and the remainder is refunded at the end (RF-01/RF-21).

A settle transaction costs ≈0.29 XLM with the house-fee leg (POC-6, ADR-026), and close and finalize cost more. Options:
- the seller deposits an XLM fee reserve at `create_market` (for example `MAX_BIDS × settle + finalize`), refunded when the market ends;
- off-chain billing.

---

## OQ-20 — Target network for the MVP

DECIDED (, ADR-024 D16): testnet only.

The OpenZeppelin Confidential Token is explicitly "Not Production Ready / unaudited", and everything so far ran on testnet. The MVP is testnet-only. Any future mainnet proposal also needs:
- a security review of the token and of our circuits;
- confirmation that the mainnet protocol version supports every host function used (BN254 and Poseidon2).

---

## OQ-21 — Custody of the envelope decryption key and `MAX_BIDS` as a product limit

DECIDED (, ADR-024 D17/D19): at most 8 bids per market initially. The envelope decryption key is kept in the operator backend DB, separate from `sk_op`.

- ADR-024 D5 covers `sk_op`. The operator's **envelope decryption key** (`PK_operator`, ADR-004) needs a custody decision too. Assumed for now: the same policy (backend DB, separate key from `sk_op`).
- `MAX_BIDS = 8` (ADR-013) means **at most 8 bids per market**, which is a product-visible limit. Needs explicit product confirmation.

---

## OQ-22 — The seller can derive each winner's price after settlement

DECIDED (, ADR-024 D20): option (a) accepted. The seller learns each winner's price after settlement; losers' prices stay hidden; no aggregation step in the MVP.

Each winning bid's payment reaches the seller as a separate confidential transfer. The seller decrypts it with its own viewing key, which it must do in order to spend the funds; POC-5 check 10.2 did exactly this. `filled_quantity` is public, so `payment ÷ filled_quantity` gives each **winner's** price. Losers' prices are never paid, and so stay hidden.

`user-history/quota-auction-journey.md` promised that the seller only sees the total. That is not what the current design delivers.

Options:
- **(a) Accept for the MVP.** The seller learns winners' prices after settlement. Simplest, and consistent with pay-as-bid; the journey and PRODUCT wording are adjusted.
- **(b) Aggregate.** Payments go into the Auction Contract's own confidential account, and after the last bid settles a single transfer of the total goes to the seller. Costs one more operator-built transfer and a final "sweep" step.

