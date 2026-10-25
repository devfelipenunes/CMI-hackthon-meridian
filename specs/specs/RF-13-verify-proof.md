# RF-13 — Verificar Prova ZK

## Dependencies
- RF-12

## Blockers
None.

## Goal
Verify `bid_validity`, `winner_allocation` and `settlement_binding` proofs on-chain, using Soroban's native BN254 host functions (CAP-0074), with contract-reconstructed trusted inputs.

## Must
- verify before bid/finalization state mutation
- reconstruct market ID, participant ID, minimum price, config hash, root, `requested_quantity` array, bid count, and total supply from state when applicable
- reject invalid proof
- freeze verifier/config after `OPEN`

## Must Not
- trust arbitrary caller-supplied public inputs
- convert verifier errors into success
- consume nullifier on failed bid proof
- hand-roll BN254 arithmetic instead of using the native host functions

## Acceptance Criteria
- valid proof succeeds
- single-bit/proof mutation fails
- wrong public input fails
- failed proof leaves state unchanged

## Related Files
- `contracts/auction-verifier/src/lib.rs`
- `contracts/auction/src/bid.rs`
- `contracts/auction/src/settlement.rs`
- `tests/verifier.rs`

## Definition of Done
- [ ] positive/negative proof vectors
- [ ] resource measurements documented

## Verifier instances
There is one UltraHonk verifier instance per circuit: `bid_validity`, `winner_allocation` and `settlement_binding` (ADR-023). Each VK is fixed at deploy time. Measured cost is about 90M CPU instructions per verification. A full settlement (1 settlement proof + 3 token transfers) uses 348.8M of 400M (ADR-026).
