
export const VERSION = "0.1.0";

export type { ConfidentialKeyProvider } from "./keys/provider.js";
export { InMemoryKeyProvider } from "./keys/memory.js";
export { BrowserKeyProvider, type BrowserKeyProviderOptions } from "./keys/browser.js";
export { buildBidValidityWitness, type BidValidityParams, type BidValidityWitness } from "./bidder/witness.js";
export { SellerApi, checkMarketParams, type Proceed, type RegisterDataProvider, type SellerContext } from "./seller/index.js";
export { BidderApi, bidLiveUntil, preflight, type BidWarning, type BidderContext, type Preflight, type PreparedBid } from "./bidder/index.js";
export { MemoryOpeningStore, verifiedOpenings, type AccountOpenings, type OpeningStore } from "./account/openings.js";
export { BrowserOpeningStore, type BrowserOpeningStoreOptions } from "./account/browser-store.js";
export { AccountApi } from "./account/index.js";
export { replayAccountEvents, type SyncResult, type SyncSource } from "./account/sync.js";
export { MarketsApi, type MarketEvent, type MarketView, type MarketsContext, type WatchOptions } from "./markets/index.js";
export type { MyBidView } from "./bidder/index.js";
export { CmiClient, connectClient, type ClientContext } from "./client.js";
