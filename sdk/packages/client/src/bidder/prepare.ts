import {
  BID_VALIDITY_PK_OPERATOR,
  CmiError,
  SETTLEMENT_MARGIN_LEDGERS,
  Secret,
  TTL_BUFFER_LEDGERS,
  addressToField,
  buildSetSpenderWitness,
  cryptoRng,
  encodeSetSpenderData,
  encryptEnvelope,
  newBidSecrets,
  silentLogger,
  type BidSecrets,
  type BidSubmission,
  type ContractId,
  type Field,
  type MarketConfig,
  type Opening,
  type Point,
} from "@zolvency-cmi/core";

import type { BidderContext } from "./context.js";
import { preflight } from "./preflight.js";
import { buildBidValidityWitness } from "./witness.js";

export type BidWarning = "DepositRevealsPrice";

export interface PreparedBid {
  marketId: bigint;
  auction: ContractId;
  participantId: number;
  requestedQuantity: number;
  submission: BidSubmission;

  publicInputs: Uint8Array[];
  setSpender: { liveUntilLedger: number; data: Uint8Array; cA: Point };
  warnings: BidWarning[];

  secrets: Secret<{ bid: BidSecrets; next: Opening; vA: bigint; rA: Field; sigmaA: Field }>;
}

export const bidLiveUntil = (config: MarketConfig): number =>
  config.params.closeLedger + config.finalizationGraceLedgers + SETTLEMENT_MARGIN_LEDGERS + TTL_BUFFER_LEDGERS;

export async function prepareBid(ctx: BidderContext, marketId: bigint, price: bigint, quantity: number): Promise<PreparedBid> {
  const rng = ctx.rng ?? cryptoRng;
  const log = ctx.logger ?? silentLogger;
  const pf = await preflight(ctx, marketId, price, quantity);
  const { auction, config } = pf;

  const participantId = pf.participantId ?? (await auction.registerParticipant(ctx.signer));

  const secrets = newBidSecrets(price, rng);
  const { envelope, r } = encryptEnvelope(secrets.expose(), ctx.pkOperator ?? BID_VALIDITY_PK_OPERATOR, rng);

  const auctionAccount = await ctx.token.account(auction.address);
  if (auctionAccount === null) throw new CmiError("Token.AccountNotRegistered", "the auction is not registered in the token");
  const vA = price * BigInt(quantity);
  const lock = buildSetSpenderWitness(
    {
      keys: pf.keys,
      spend: new Secret(pf.openings.expose().spendable),
      vA,
      yOp: auctionAccount.spendingKey,
      opI: addressToField(auction.address),
      kAudS: await ctx.token.auditorKey(pf.account.auditorId),
    },
    rng,
  );
  const delegation = lock.delegation.expose();

  const configHash = await auction.getConfigHash();
  if (configHash === null) throw new CmiError("MarketNotOpen", "the market has no config_hash");
  const bv = buildBidValidityWitness({
    secrets,
    marketId: config.marketId,
    participantId,
    requestedQuantity: quantity,
    minPricePerQuota: config.params.minPricePerQuota,
    collateral: { cA: lock.payload.cA, rA: new Secret(delegation.rA) },
    envelope,
    r,
    configHash,
  });
  const bidProof = await ctx.prover.prove("bid_validity", bv.inputs);

  const lockProof = await ctx.prover.prove("set_spender", lock.inputs);

  const warnings: BidWarning[] = pf.openings.expose().lastDeposit === vA ? ["DepositRevealsPrice"] : [];
  log.info("bid prepared", { marketId: marketId.toString(), participantId, requestedQuantity: quantity, warnings });

  return {
    marketId,
    auction: auction.address,
    participantId,
    requestedQuantity: quantity,
    submission: { requestedQuantity: quantity, commitment: bv.commitment, nullifier: bv.nullifier, envelope, proof: bidProof.proof },
    publicInputs: bv.publicInputs,
    setSpender: { liveUntilLedger: bidLiveUntil(config), data: encodeSetSpenderData(lock, lockProof.proof), cA: lock.payload.cA },
    warnings,
    secrets: new Secret({ bid: secrets.expose(), next: lock.next.expose(), vA, rA: delegation.rA, sigmaA: delegation.sigmaA }),
  };
}
