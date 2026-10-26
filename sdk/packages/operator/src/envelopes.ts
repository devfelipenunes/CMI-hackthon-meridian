import {
  CmiError,
  addressToField,
  bidCommitment,
  commitmentsRoot,
  decryptEnvelope,
  deriveTokenKeys,
  recoverDelegation,
  type AccountId,
  type AuctionPort,
  type BidRecord,
  type BidSecrets,
  type ContractId,
  type Logger,
  type Scalar,
  type Secret,
  type TokenPort,
} from "@zolvency-cmi/core";

export interface DecryptedBid {
  bidIndex: number;
  bidder: AccountId;
  participantId: number;
  requestedQuantity: number;
  secrets: Secret<BidSecrets>;
}

export interface ReadBidsParams {
  auction: AuctionPort;
  token: TokenPort;
  tokenAddress: ContractId;

  spenderKey: Secret<Scalar>;

  envelopeKey: Secret<Scalar>;
  logger: Logger;
}

export async function readBids(p: ReadBidsParams): Promise<DecryptedBid[]> {
  const { auction, token, logger } = p;
  const { marketId } = await auction.getMarket();
  const count = await auction.getBidCount();
  const records: BidRecord[] = [];
  for (let i = 0; i < count; i++) records.push(await auction.getBidRecord(i));

  const onChainRoot = await auction.getCommitmentsRoot();
  if (onChainRoot === null) throw new CmiError("RootMismatch", "there is no on-chain commitments root yet (the market is not closed)");
  if (onChainRoot !== commitmentsRoot(records.map((r) => r.commitment))) {
    throw new CmiError("RootMismatch", "the commitments root recomputed from the accepted bids differs from the on-chain root");
  }

  const skEnv = p.envelopeKey.expose();
  const skOp = deriveTokenKeys(p.spenderKey.expose(), addressToField(p.tokenAddress)).sk;
  const auctionF = addressToField(auction.address);
  const bids: DecryptedBid[] = [];
  for (const [bidIndex, r] of records.entries()) {
    const secrets = openBid(r, bidIndex, marketId, skEnv);
    const s = secrets.expose();

    const d = await token.delegation(r.bidder, auction.address);
    if (d === null) {
      logger.info("bid without collateral delegation; kept for release_unsettled", { bidIndex });
    } else if (recoverDelegation(d, skOp, auctionF).expose().vA !== s.price * BigInt(r.requestedQuantity)) {
      throw new CmiError("CollateralMismatch", `bid ${bidIndex}: the locked collateral is not price × requested_quantity`);
    }

    bids.push({ bidIndex, bidder: r.bidder, participantId: r.participantId, requestedQuantity: r.requestedQuantity, secrets });
  }
  logger.info("bids read and validated", { auction: auction.address, count });
  return bids;
}

export function openBid(r: BidRecord, bidIndex: number, marketId: bigint, skEnv: Scalar): Secret<BidSecrets> {
  const secrets = decryptEnvelope(r.envelope, skEnv);
  if (!opens(r, secrets.expose(), marketId)) throw new CmiError("OpeningMismatch", `bid ${bidIndex}: the envelope does not open the accepted commitment`);
  return secrets;
}

function opens(r: BidRecord, s: BidSecrets, marketId: bigint): boolean {
  try {
    return bidCommitment({ ...s, marketId, participantId: r.participantId }) === r.commitment;
  } catch (e) {
    if (e instanceof RangeError) return false;
    throw e;
  }
}
