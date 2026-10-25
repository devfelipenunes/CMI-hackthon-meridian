# ADR-018 — Collateral equals price × requested quantity, custodied via the Confidential Token's allowance primitive

## Context
ADR-006 fixed `locked_collateral_value == bid_value` for a single-unit, winner-take-all design, and left the exact collateral representation/linkage as an open blocker. The protocol has since moved to a multi-unit, pay-as-bid design where each bid has both a price per quota and a requested quantity, and collateral custody reuses Stellar's own Confidential Token rather than a custom commitment.

## Decision
For every submitted bid:
```text
locked_collateral_value == price × requested_quantity
```
locked via the Confidential Token's `set_spender` operation, naming the Auction Contract as spender. `price` and the lock amount are confidential (Pedersen/Grumpkin, per the token's own account model); `requested_quantity` is public.

At settlement, for a bid allocated `filled_quantity` (which may be less than `requested_quantity` for the marginal bid at the clearing price, per ADR-019):
- the amount `price × filled_quantity` moves to the seller via `confidential_transfer_from`;
- any remaining locked amount (covering `requested_quantity − filled_quantity`) returns to the bidder via `revoke_spender`.

A bid allocated zero quantity releases its entire locked amount via `revoke_spender`.

## Consequences
Pros:
- no custom collateral-commitment format to invent or maintain;
- partial-fill refunds are a natural consequence of the allowance model, not a special case;
- settlement and refund both reduce to operations the Confidential Token already implements.

Cons:
- depends entirely on the real deployed Confidential Token's exact interface — confirmed against source as of this ADR's update, but still developer-preview/unaudited;
- `set_spender` and `revoke_spender` are themselves proof-carrying calls (see Update) — this adds a client-side proving step to locking and reclaiming collateral that earlier drafts of this ADR did not account for.

## Update — confirmed against real source (, `OpenZeppelin/stellar-contracts@539968f`, branch `feat/confidential-verifier-ultrahonk`)

This update replaces every assumption in the original decision with what the actual pinned source (`packages/tokens/src/confidential/{mod,storage}.rs`) shows. Do not re-open these as open questions — they are read directly from code, not inferred:

1. **The real function name is `confidential_transfer_from(spender, from, to, data: Bytes)`, not `spender_transfer`.** The underlying circuit type is internally called `SpenderTransfer`, but the callable contract entry point is `confidential_transfer_from`. Every spec/doc in this pack has been corrected to use the real name.
2. **Partial consumption is confirmed supported.** `confidential_transfer_from` writes a new `c_a_new` back into the delegation (`delegation.allowance_commitment = payload.c_a_new`) rather than deleting it — the allowance survives a partial draw, exactly as this ADR's settlement design (ADR-020/RF-20) requires: pay the filled portion, then `revoke_spender` the remainder in the same per-bid call. OQ-02's partial-consumption question is resolved.
3. **`set_spender` and `revoke_spender` both require a ZK proof from the account owner**, not a bare authorized call — `set_spender(account, spender, live_until_ledger, data)` and `revoke_spender(account, spender, data)` both decode a proof out of `data` and verify it before touching storage. RF-09 must account for this as a client-side proving step, distinct from the `bid_validity` proof.
4. **`set_spender` takes an explicit `live_until_ledger`, and the delegation expires.** `confidential_transfer_from` panics with `DelegationExpired` if `ledger.sequence() > delegation.live_until_ledger` at call time. `revoke_spender` does not check expiry — it works "for both active and expired-but-not-revoked delegations," so a bidder can never lose access to their own funds, but a *seller* can lose an expected payment if the bidder's `live_until_ledger` lapses before settlement runs. RF-09/RF-14 must validate `live_until_ledger >= finalize_by_ledger` (plus a safety margin for settlement-automation latency) as a bid acceptance precondition.
5. **The allowance is strictly one-per-(account, spender) pair — this resolves OQ-10.** `set_spender` reverts with `DelegationAlreadyExists` if a live delegation already exists for that exact pair. The `op_i` value referenced in earlier drafts of this pack (and in general secondary research) is **not** a free index for multiple simultaneous delegations — it is computed as `op_i = address_to_field(spender)`, used purely for domain-separating the proof to a specific spender address. **There is no mechanism in the real contract for a single (account, spender) pair to hold more than one active delegation.** See OQ-10's resolution in `docs/OPEN_QUESTIONS.md`.

## Blocker
**Closed** by the live round trip in the update below (POC-5). The text that follows is kept as the original record.

Exact end-to-end integration testing against the live deployment (see `plans/003-collateral-linkage.md` for the real testnet addresses) is still pending — this ADR fixes the economic rule and confirms the primitive's interface, but does not mark integration testing complete. OQ-11 (a bidder deliberately revoking after acceptance) remains open as an accepted, self-contained risk; the `live_until_ledger` finding above closes the *negligent-expiry* half of that risk but not the *deliberate-revocation* half.

## Update — collateral-linkage circuit built and validated with real generator points

`POC/poc-3-collateral-linkage` implements and validates `collateral_binding == (price × requested_quantity) · G + collateral_randomness · H` — this ADR's constraint 5 from `docs/CRYPTO.md`'s `bid_validity` circuit spec — using the Confidential Token's **real** `G`/`H`, not a placeholder.

The generator points were not guessed: they were read directly from the pinned Confidential Token source (`packages/tokens/src/confidential/circuits/lib/src/lib.nr`, `pub global G` / `pub global H` — Barretenberg's `derive_generators("DEFAULT_DOMAIN_SEPARATOR", 0)`) and **independently reproduced** by running that repository's own `print_generators` provenance test with this project's pinned Noir toolchain; the printed values matched the hardcoded constants byte for byte. The real token's `commit(v, r) = v·G + r·H` (its own `SetSpender` circuit, constraint S7) is exactly this ADR's formula — confirmed, not assumed. One nuance not previously modeled: in the real `SetSpender` circuit, the allowance's blinding factor `r_a` is not a free/arbitrary value chosen by the bidder — it is deterministically derived, `r_a = Poseidon2(ALLOWANCE_RANDOMNESS, dvk, sigma_a)`, from the bidder's own delegation viewing key. This does not change this ADR's constraint shape (the bidder can recompute their own `r_a` and supply it as an opaque `bid_validity` witness exactly as before) — it only means `collateral_randomness` should be documented as "the real `r_a` the bidder derived when locking collateral," not as a value they are free to choose.

Rebuilt with these real constants, the circuit was re-proved, re-verified locally (including the mismatched-value rejection case), and verified on real Soroban testnet infrastructure: contract `CDDP6V3GFM44B5XD7YGWN4WLSEUAVZG2FYMK3UKH7DTBRBFN7CTFP3Y5`, `verify_proof` succeeded, 94,575,384 CPU instructions.

**What this narrows the remaining blocker to, precisely**: what is confirmed is the *circuit's* own math and public-input layout (`collateral_binding` as a plain `(x, y)` Field pair, matching `SetSpender`'s own public-input list). What remains unconfirmed is the deployed *contract's* actual byte-level encoding for a `get_spender_delegation` read, and whether the live testnet contract is running the exact source commit this was read from — closing that needs an actual live `set_spender` call, which in turn requires hand-building that circuit's full 13-constraint witness (the demo's TypeScript SDK does not implement a `set_spender` flow at all) on top of a register/deposit/merge prerequisite chain. Estimated as multi-hour work; explicitly deferred rather than rushed. See `POC/results/poc-3-generator-confirmation.log` for the exact account of what is and is not closed, and `docs/OPEN_QUESTIONS.md` OQ-02 for the canonical status.

## Update — live round trip against the deployed contract (, POC-5)

`POC/poc-5-live-confidential-token` exercised this ADR against the live testnet deployment with a Soroban contract as spender, which closes the "Blocker" section above. Confirmed live:

- The live token, verifier and auditor code, and all six VKs, are byte-identical to OZ `539968f`.
- `get_spender_delegation.allowance_commitment` is the raw 64-byte `be(x) ‖ be(y)` of `v_a·G + r_a·H`. The POC-3 linkage circuit verifies against that live `C_a`, locally and on-chain. OQ-02 is resolved.
- Partial consumption works (points 2 and 4 above), and so do `DelegationAlreadyExists` and `DelegationExpired` (point 5).

**Contradicts the Decision section (needs a decision before RF-20):**

1. **The remainder cannot be returned via `revoke_spender` as part of automatic settlement.** `revoke_spender` needs the *bidder's* proof (their `sk`) and signature. Live, a third party submitting a valid bidder proof was refused. The path that works is `confidential_transfer_from(spender = auction, from = bidder, to = bidder)`, called by the auction contract. It is permissionless to submit and needs no bidder action, and the refund lands in the bidder's receiving balance. A zero-filled bid is refunded the same way, for the full amount.
2. **The Auction Contract must itself be a registered confidential account.** Its spending secret `sk_op` is held off-chain by the operator, and every payment or refund proof is built with it. Register it in the constructor so nobody can register the address first.
3. **The amount is not bound by the token.** SpenderTransfer only proves `v_tx ≤ allowance`, so the auction must verify its own proof binding `c_tx` to `price × filled_quantity` (OQ-13, BLOCKER).
4. **Price visibility at lock time.** The holder of `sk_op` and the token's auditor can both decrypt `v_a = price × requested_quantity` (OQ-14).
5. **No validation of `live_until_ledger` by the token.** The token accepts a `live_until_ledger` already in the past, and after expiry the spender-driven refund fails too. The RF-09/RF-14 bound (point 4 above) is the only guard, and it protects refunds as well as payments (OQ-11).

## Forbidden
Do not invent a parallel collateral-commitment format outside the Confidential Token's own account model. Do not mark collateral linkage complete using a mocked or clear-value token. Do not deploy a single Auction Contract instance to serve more than one concurrently-open market — per point 5 above, this is not a design preference, it is a hard constraint of the real allowance model.
