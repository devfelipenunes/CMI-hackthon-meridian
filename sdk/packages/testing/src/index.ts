
export const VERSION = "0.0.0";

export { SeededRng } from "./rng.js";
export { FakeClock } from "./clock.js";
export { MemoryLogger, type LogEntry } from "./logger.js";
export { assertNoSecretLeak } from "./assertions.js";
export { AURORA, type ScenarioBid } from "./scenarios.js";
export {
  LOCALNET,
  TESTNET,
  bidWindow,
  ledgersFor,
  setTestNetwork,
  testNetwork,
  type TestNetwork,
  LOCAL_DEPLOYMENT_PATH,
  PINNED_WASM_SHA256,
  TOKEN_VK_CIRCUITS,
  auditorKeyHex,
  fundAccount,
  loadLocalDeployment,
  localChain,
  parseDeployment,
  registerLocalAccount,
  type LocalDeployment,
} from "./localnet.js";
export { CallLog, type CallEntry } from "./fakes/log.js";
export { FAKE_PLATFORM, FakeAuction, MARKET_TRANSITIONS, fakeBidRecord, type FakeAuctionOptions } from "./fakes/auction.js";
export { FakeFactory } from "./fakes/factory.js";
export { FakeProver } from "./fakes/prover.js";
export { addTrustline, issueQuotaAsset, type QuotaAsset } from "./quota.js";
export { FakeQuota, FakeToken } from "./fakes/token.js";
