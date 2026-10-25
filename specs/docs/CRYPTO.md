# CRYPTO — CMI Auctions

## Goals

The cryptographic layer must prove:

1. an accepted bid commitment has a valid opening;
2. the bid satisfies the minimum price per quota and its declared collateral;
3. quotas are allocated over the canonical commitment set using the clearing-price rule (ADR-019), honoring each bid's public `requested_quantity`;
4. no bid price becomes a public input, at any stage.

## Domain separation

All Poseidon constructions must include explicit protocol constants.

Example symbolic domains:

```text
BID_COMMIT_DOMAIN
NULLIFIER_DOMAIN
BID_LEAF_DOMAIN
EMPTY_LEAF_DOMAIN
BID_ENVELOPE_MASK_DOMAIN
```

**Frozen in ADR-025:** `BID_COMMIT_DOMAIN = 1001`, `BID_ENVELOPE_MASK_DOMAIN = 1002`, `BID_LEAF_DOMAIN = 1003`, `NULLIFIER_DOMAIN = 1004`, and `EMPTY_LEAF = 999999`, which is a padding leaf value rather than a tag. All are disjoint from the Confidential Token's tags (1–15).

Use Poseidon2 (Soroban's native host function, CAP-0075) rather than a WASM implementation, and fix and document the exact round parameters used — see ADR-001's update note. **Implementation note confirmed while building the POCs**: `std::hash::poseidon2::Poseidon2::hash` is `pub(crate)` in Noir 1.0.0-beta.9 — not accessible to user code. There is no public convenience "hash N field elements" wrapper; circuits must hand-build a duplex sponge over the low-level `poseidon2_permutation(state, state_length)` foreign function (IV in `state[RATE]`, `RATE=3`, `CAPACITY=1`), replicating the stdlib's own private construction. The first POC port of this helper **overwrote** `state[0]` instead of adding to it once the rate was full, a non-standard hash for inputs longer than 3 elements. It was corrected on  (ADR-025). The standard is the Confidential Token's `lib.nr::sponge`, and every POC circuit that hashes now carries a parity test against it (e.g. `POC/poc-2-envelope-consistency/circuit/src/main.nr`, `poseidon2_matches_confidential_token_sponge`).

## Market and participant identifiers

- `market_id: u64`
- `participant_id: u32`
- `bid_index: u32`
- `requested_quantity: u32` — public per accepted bid, tracked as contract state alongside `bid_index`, not field-encoded specially and not part of any commitment.

These (except `requested_quantity`, which is a plain public counter) are field-friendly and avoid converting Stellar `Address` values directly inside circuits.

## Bid commitment

Target construction:

```text
C = Poseidon(
    BID_COMMIT_DOMAIN,
    price,
    market_id,
    participant_id,
    blinding,
    nullifier_seed
)
```

`price` is the bid's price per quota — the one value that must never appear as a public input or in clear text anywhere. Required properties of `C`:

- hiding;
- binding;
- market-scoped;
- participant-scoped.

## Nullifier

```text
N = Poseidon(
    NULLIFIER_DOMAIN,
    nullifier_seed,
    market_id,
    participant_id
)
```

## Bid envelope

Private opening material:

```text
BidPrivateData {
    price,
    blinding,
    nullifier_seed
}
```

The envelope mechanism must guarantee that an accepted encrypted payload cannot permanently brick allocation proving.

**Resolved (, OQ-01) — adopted construction: ECDH-derived masking, proved inside `bid_validity` itself**, not a separate proof and not operator pre-validation. Validated end to end as `POC/poc-2-envelope-consistency`; frozen in `ADR-004`'s update.

```text
R                    = r · G                                    (bidder's ephemeral point, public)
S                    = r · PK_operator                          (shared secret, sender side, private)
mask_price           = Poseidon2(BID_ENVELOPE_MASK_DOMAIN, S.x, S.y, 0)
mask_blinding        = Poseidon2(BID_ENVELOPE_MASK_DOMAIN, S.x, S.y, 1)
mask_seed            = Poseidon2(BID_ENVELOPE_MASK_DOMAIN, S.x, S.y, 2)
ciphertext_price     = price + mask_price
ciphertext_blinding  = blinding + mask_blinding
ciphertext_seed      = nullifier_seed + mask_seed
```

`price`, `blinding`, `nullifier_seed` are the *same* private witnesses used to open the bid commitment (below) — proved by the same circuit, in the same proof, so a commitment/envelope divergence is structurally unprovable, not merely discouraged by policy. The operator decrypts by recomputing `S' = sk_operator · R` (ECDH commutativity: `S' == S`) and subtracting the mask; this round trip was independently confirmed to recover the exact original `price`, not just asserted from ECDH theory.

`R`, `ciphertext_price`, `ciphertext_blinding`, `ciphertext_seed` are public inputs to `bid_validity` (already included in that circuit's public-input list below). `PK_operator` is a protocol-wide constant (the operator's public key, whose private key is kept in the operator backend DB, ADR-024 D19), not a per-bid input.

Do not assume that ordinary encryption alone proves ciphertext/plaintext consistency — the construction above is why it isn't needed: consistency is a byproduct of witness reuse, not a separate proof step.

## Collateral linkage

Per ADR-018, collateral is locked via Stellar's Confidential Token: the bidder calls `set_spender`, naming the Auction Contract as spender, for `price × requested_quantity`. That call produces a Pedersen commitment over the Grumpkin curve, `C_a = locked_collateral_value · G + r · H`, held in the token's own on-chain state for the (participant, Auction Contract) pair.

A bid-validity proof must bind the circuit's private `price` witness to that real `C_a`:

```text
C_a == (price × requested_quantity) · G + collateral_randomness · H
```

`requested_quantity` is a public scalar here (already known), so this is a single Grumpkin scalar multiplication plus a point-addition equality check — cheap and native if `bid_validity` is itself written in Noir/UltraHonk over the BN254 scalar field (ADR-017), since Grumpkin's base field is BN254's scalar field.

**Resolved (, OQ-02, circuit side) — `G` and `H` are confirmed, not placeholders**, read directly from the pinned Confidential Token source and independently reproduced with this project's own toolchain (`ADR-018`'s update, `POC/results/poc-3-generator-confirmation.log`):

```text
G = (0x083e7911d835097629f0067531fc15cafd79a89beecb39903f69572c636f4a5a,
     0x1a7f5efaad7f315c25a918f30cc8d7333fccab7ad7c90f14de81bcc528f9935d)
H = (0x054aa86a73cb8a34525e5bbed6e43ba1198e860f5f3950268f71df4591bde402,
     0x209dcfbf2cfb57f9f6046f44d71ac6faf87254afc7407c04eb621a6287cac126)
```

These are Barretenberg's own Pedersen generators, `derive_generators("DEFAULT_DOMAIN_SEPARATOR", 0)` — the real token computes `C_a = commit(v_a, r_a) = v_a·G + r_a·H` (`SetSpender` circuit, constraint S7), exactly this equation. **Nuance confirmed from the real `SetSpender` circuit that this document did not previously capture**: `collateral_randomness` (`r_a` above) is not a value the bidder is free to choose — it is deterministically derived, `r_a = Poseidon2(ALLOWANCE_RANDOMNESS, dvk, sigma_a)`, from the bidder's own delegation viewing key and a salt. This does not change `bid_validity`'s constraint (the bidder can recompute their own `r_a` and supply it as an opaque private witness exactly as written above) — it only means implementers should not model `collateral_randomness` as freely chosen.

**Encoding confirmed live (, OQ-02 resolved, `POC/poc-5-live-confidential-token`).**
- **In the circuit:** a Grumpkin point is a plain `(x, y)` pair of `Field` elements.
- **On the contract:** `get_spender_delegation` returns `allowance_commitment` as the raw 64 bytes `be(x) ‖ be(y)`, with the identity as all zeros.
- **End to end:** the POC-3 circuit verified against a `C_a` read from the deployed token.
- **Trusted input:** the Auction Contract must read `C_a` itself from the token (`get_spender_delegation`), never take it from the caller. It must also check `live_until_ledger`, which the token does not validate (OQ-11).

Circuit built, proved, and verified on real Soroban testnet infrastructure with these exact generator values: `POC/poc-3-collateral-linkage`, contract `CDDP6V3GFM44B5XD7YGWN4WLSEUAVZG2FYMK3UKH7DTBRBFN7CTFP3Y5`.

Plan: `plans/003-collateral-linkage.md` (REVIEW).

## `bid_validity` circuit

**the design is fixed. Constraint 5 and the envelope group are individually validated by working POC circuits (`POC/poc-3-collateral-linkage`, `POC/poc-2-envelope-consistency`, re-run with the standard Poseidon2 of ADR-025) and against the live token (POC-5). They are not yet merged and compiled as one production circuit.** The witness/public-input lists below are updated to include the envelope fields (OQ-01's resolution); merging the actual `.nr` source is implementation work, not a remaining design question.

### Private witness

```text
price
blinding
nullifier_seed
collateral_randomness   // the real Confidential Token's r_a — deterministically derived by the bidder, not free (see Collateral linkage above)
r                        // envelope ephemeral scalar
```

### Public inputs

```text
commitment
nullifier
market_id
participant_id
requested_quantity
min_price_per_quota
collateral_binding      // C_a, the Confidential Token's Grumpkin point for this bid's locked allowance
r_point                 // R = r·G, the envelope's ephemeral public point (x, y)
ciphertext_price
ciphertext_blinding
ciphertext_seed
config_hash_lo
config_hash_hi
```

`config_hash` is a 32-byte contract-side hash represented as two 128-bit limbs for proof inputs. `collateral_binding` and `r_point` are each Grumpkin points, represented as a plain `(x, y)` pair of field elements. `collateral_binding` is read by the contract from `get_spender_delegation` (64 raw bytes, `be(x) ‖ be(y)`; confirmed live, OQ-02).

### Constraints

```text
1. commitment opening is valid
2. nullifier derivation is valid
3. price > 0 and price < 2^63            (so price × quantity < 2^127, the token's amount range; same bound as settlement_binding)
4. price >= min_price_per_quota
5. collateral_binding == (price × requested_quantity) · G + collateral_randomness · H
6. r_point == r · G
7. S == r · PK_operator                                              (private intermediate, not a public input)
8. ciphertext_price    == price + Poseidon2(BID_ENVELOPE_MASK_DOMAIN, S.x, S.y, 0)
9. ciphertext_blinding == blinding + Poseidon2(BID_ENVELOPE_MASK_DOMAIN, S.x, S.y, 1)
10. ciphertext_seed    == nullifier_seed + Poseidon2(BID_ENVELOPE_MASK_DOMAIN, S.x, S.y, 2)
```

Constraint 5 is validated by `POC/poc-3-collateral-linkage` using the real Confidential Token generators (Collateral linkage, above); constraints 6-10 are validated by `POC/poc-2-envelope-consistency` (Bid envelope, above). Both compile, prove, and verify on real Soroban testnet infrastructure independently. What remains is merging them (plus 1-4, which no POC specifically targeted since they are straightforward Poseidon2/comparison constraints already exercised as part of every POC's commitment-opening logic) into one circuit, compiling it once, and re-measuring its combined cost (expected to stay in the same flat verification-cost band per OQ-03 — see that entry for why).

## Canonical leaf

For bid `i`:

```text
leaf_i = Poseidon(
    BID_LEAF_DOMAIN,
    bid_index_i,
    commitment_i
)
```

Unused positions use `EMPTY_LEAF = 999999`. `requested_quantity_i` is a parallel public array tracked by the contract, not part of `leaf_i`.

```text
commitments_root = Poseidon2(leaf_0, …, leaf_7)     // standard sponge, recomputed by the contract at close (ADR-025)
```

## `winner_allocation` circuit

**formalized, implemented, and validated at the production `MAX_BIDS=8` — OQ-09 resolved.** `POC/poc-4-clearing-price-allocation` implements this circuit's full constraint set below (root reconstruction plus the allocation rule) and is compiled, proved, and verified on real Soroban testnet infrastructure at `MAX_BIDS=8` (re-run with the standard Poseidon2 of ADR-025: contract `CA5BVAXDEHVEBTRINPAPT2K7YCX7MBBFOC4I43BZVT7KKDXRCMLMPNSE`, 92,164,085 CPU instructions). What remains is merging this validated `.nr` source into the production contract's circuit build, not designing it. **Note:** the POC uses a simplified two-field commitment; the production circuit must use the full commitment below (ADR-025).

This circuit replaces a single-winner argmax with a multi-unit, pay-as-bid clearing-price allocation (ADR-019). It relies on an important invariant:

> Every leaf in the canonical root already corresponds to an accepted bid that passed `bid_validity`.

Therefore this circuit does not need to re-prove collateral or the minimum-price constraint — it only needs to prove that a claimed allocation is the one implied by the real, canonical bid set.

### Private witness

```text
prices[MAX_BIDS]
blindings[MAX_BIDS]
nullifier_seeds[MAX_BIDS]
participant_ids[MAX_BIDS]
clearing_price
```

`clearing_price` is a private value the operator derives from the real bids; it is never a public input.

### Public inputs

```text
commitments_root
requested_quantities[MAX_BIDS]
filled_quantities[MAX_BIDS]
bid_count
total_supply
market_id
auction_rule
config_hash_lo
config_hash_hi
```

### Constraints

For `i < bid_count`:

```text
commitment_i ==
    Poseidon(
        BID_COMMIT_DOMAIN,
        prices[i],
        market_id,
        participant_ids[i],
        blindings[i],
        nullifier_seeds[i]
    )

leaf_i == Poseidon(BID_LEAF_DOMAIN, i, commitment_i)
```

For `i >= bid_count`:

```text
leaf_i == EMPTY_LEAF
prices[i] == 0
requested_quantities[i] == 0
filled_quantities[i] == 0
```

Then:

```text
reconstructed_root == commitments_root
```

Allocation rule, for every `i < bid_count`:

```text
filled_quantities[i] <= requested_quantities[i]

prices[i] > clearing_price  ⇒  filled_quantities[i] == requested_quantities[i]
prices[i] < clearing_price  ⇒  filled_quantities[i] == 0
```

**Adopted formalization for bids exactly at `clearing_price` (the margin) — a single running-accumulator pass in natural `bid_index` order, no sorting needed**, because `bid_index` already is the FCFS priority order:

```text
above_total = 0
tied_used   = 0
for i in 0..MAX_BIDS:
    active   = i < bid_count
    is_above = active & (prices[i] > clearing_price)
    is_tied  = active & (prices[i] == clearing_price)

    remaining_before_i = total_supply - above_total - tied_used
    tied_fill_i = min(requested_quantities[i], remaining_before_i)

    expected_filled_i = requested_quantities[i] if is_above
                         else tied_fill_i        if is_tied
                         else 0
    assert filled_quantities[i] == expected_filled_i

    above_total += requested_quantities[i] if is_above else 0
    tied_used   += filled_quantities[i]    if is_tied  else 0
```

Validated (`POC/poc-4-clearing-price-allocation`, `docs/OPEN_QUESTIONS.md` OQ-09): a genuine partial fill at the margin *and* a tied bid shut out entirely once the margin is exhausted, in the same scenario; a dedicated tie-break test confirming the lower `bid_index` wins a contested remainder; the undersubscription degenerate case, using the exact same formula with no special branch.

Finally:

```text
sum(filled_quantities) == min(total_supply, sum(requested_quantities))
```

This single equation also covers undersubscription as a degenerate case: when total demand is below `total_supply`, every bid must fill in full.

**`clearing_price` is not required to equal any real bid's price.** When total supply is exhausted strictly between two distinct bid prices, every value in that open interval satisfies the constraints above identically, and produces the same `filled_quantities`. Do not add a constraint forcing `clearing_price` to match an actual bid's price — it would be redundant at best, and could make an otherwise-valid allocation unprovable in the gap case. See OQ-09.

## `settlement_binding` circuit

**implemented and validated live (`POC/poc-6-atomic-settlement`), frozen in ADR-023 + ADR-026 (house fee).** 95 ACIR opcodes, 3,702 gates.

It closes OQ-13: the Confidential Token's `SpenderTransfer` proof only establishes `0 ≤ v_tx ≤ allowance`, so the Auction Contract verifies this proof before forwarding each bid's three token payloads (seller, fee, refund).

### Private witness

```text
price, market_id, participant_id, blinding, nullifier_seed, fee, fee_rem, r_seller, r_fee, r_refund
```

### Public inputs (frozen order, each a 32-byte big-endian field)

```text
bid_commitment          // contract state (from the accepted bid)
requested_quantity      // contract state
filled_quantity         // contract state (from the verified allocation)
fee_bps                 // contract constant: 1000 (10%) in the MVP
c_seller.x, c_seller.y  // decoded from the seller-leg SpenderTransferPayload.c_tx
c_fee.x, c_fee.y        // decoded from the fee-leg SpenderTransferPayload.c_tx
c_refund.x, c_refund.y  // decoded from the refund-leg SpenderTransferPayload.c_tx
```

### Constraints

```text
1. bid_commitment == Poseidon2(BID_COMMIT_DOMAIN, price, market_id, participant_id, blinding, nullifier_seed)
2. requested, filled < 2^64; requested - filled < 2^64; price < 2^63; fee_bps <= 10000
3. gross = price × filled_quantity
   fee · 10000 + fee_rem == gross · fee_bps,  fee < 2^127,  0 <= fee_rem < 10000      (fee = floor(gross·bps/10000))
4. c_seller == (gross − fee) · G + r_seller · H
5. c_fee    == fee · G + r_fee · H
6. c_refund == (price × (requested − filled)) · G + r_refund · H
```

`G`/`H` are the Confidential Token's generators. `bid_validity` fixed the escrow at `price × requested_quantity`, so seller + fee + refund consume it exactly.

## Proving system

MVP target (ADR-017):

- UltraHonk over Noir;
- BN254 scalar field as the proving field, Grumpkin as the embedded curve for the collateral-linkage constraint;
- Poseidon2, the Confidential Token's standard sponge (ADR-025), for this protocol's own commitment/nullifier/leaf/root hashing.

**Measured, not just targeted (, OQ-03)**: proof size is a constant 14,592 bytes and VK size a constant 1,760 bytes regardless of circuit complexity (UltraHonk's succinctness property, confirmed empirically). On-chain verification cost on real Soroban testnet is essentially flat across every circuit measured so far — 90.3M to 94.6M CPU instructions per verification, a 5% band, despite an order-of-magnitude difference in ACIR opcode count between the smallest and largest circuit measured. Pinned toolchain: `nargo 1.0.0-beta.9` + `bb 0.87.0` with `--scheme ultra_honk --oracle_hash keccak` (this exact flag combination is required to match the Soroban verifier's expected proof format — a newer `nargo` was confirmed incompatible with this `bb` version, producing an opaque `"Length is too large"` error). See `POC/results/SUMMARY.md` for full detail and `docs/OPEN_QUESTIONS.md` OQ-03 for the resolution. A full per-bid settlement (the settlement proof, three token transfers each with its own proof, and the quota transfer) measured 348.8M of the 400M instructions per transaction (POC-6, ADR-026).

## Public-input ordering

Public-input order is part of the protocol. Once a verifying key exists, do not reorder inputs without:

1. a new ADR;
2. a new circuit/verifying key;
3. updated contract code;
4. updated test vectors.

## Security rule

Do not change:

- commitment layout;
- nullifier layout;
- canonical leaf layout;
- empty-leaf convention;
- public-input ordering;
- proving system;
- the clearing-price allocation rule (ADR-019);
- the collateral-binding representation (ADR-018);
- the settlement-binding statement and its public-input order (ADR-023, ADR-026);
- the Poseidon2 sponge and the domain table (ADR-025);

without a new ADR.
