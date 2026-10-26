import { buildSetSpenderWitness, buildSpenderTransferWitness, recoverDelegation, settlementAmounts } from "../../src/index.js";
import { delegationFrom } from "./delegation.js";
import { fixture } from "./token-fixture.js";

export function legsScenario() {
  const f = fixture();
  const setSpender = buildSetSpenderWitness(f.params, f.rng);
  const onChain = delegationFrom(setSpender);
  const recovered = recoverDelegation(onChain, f.auction.sk, f.params.opI);

  const amounts = settlementAmounts(650n, 200, 120).expose();
  const common = { skOp: f.auction.sk, yOp: f.auction.Y, kAudR: f.params.kAudS, kAudS: f.params.kAudS };
  const seller = buildSpenderTransferWitness({ ...common, allowance: recovered, vTx: amounts.seller, pvkRecipient: f.seller.PVK }, f.rng);
  const fee = buildSpenderTransferWitness({ ...common, allowance: seller.next, vTx: amounts.fee, pvkRecipient: f.feeWallet.PVK }, f.rng);
  const refund = buildSpenderTransferWitness({ ...common, allowance: fee.next, vTx: amounts.refund, pvkRecipient: f.bidder.PVK }, f.rng);
  return { f, setSpender, onChain, recovered, amounts, common, legs: { seller, fee, refund } };
}
