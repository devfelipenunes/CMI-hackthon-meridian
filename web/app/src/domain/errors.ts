import { CmiError, type CmiRecovery } from "@zolvency-cmi/core";

interface Translation {
  title: string;
  detail: string;
  recovery?: Recovery;
}

interface Recovery {
  kind: "change_trust" | "revoke_spender" | "retry" | "import_backup" | "setup" | "deposit";
  action: string;
}

export interface ErrorText {
  title: string;
  detail: string;
  recovery?: Recovery;
  code?: string;
}

const retry = (): Recovery => ({ kind: "retry", action: "Try again" });
const setup = (): Recovery => ({ kind: "setup", action: "Create confidential account" });
const deposit = (): Recovery => ({ kind: "deposit", action: "Deposit XLM" });

const AUCTION_MESSAGES: Record<string, Translation> = {
  InvalidTotalQuotas: { title: "Invalid quota quantity", detail: "Total quotas must be greater than zero and fit in 32 bits." },
  InvalidMinPrice: { title: "Invalid floor price", detail: "Use a value greater than zero and below 2⁶³ stroops." },
  InvalidCloseLedger: { title: "Close time in the past", detail: "Choose a close date in the future." },
  DurationTooLong: { title: "Duration over 30 days", detail: "Move the close date closer; the maximum is 30 days." },
  InvalidFeeReserve: { title: "Insufficient fee reserve", detail: "The minimum reserve is 5 XLM." },
  InvalidState: { title: "Action unavailable in this state", detail: "The auction changed state. Refresh the page and check the current action." },
  TooEarly: { title: "Too early for this action", detail: "Wait for the ledger indicated by the contract." },
  TooLate: { title: "The deadline has passed", detail: "This action is no longer possible in this auction." },
  BiddingClosed: { title: "Bidding closed", detail: "The auction closed. Nothing was locked." },
  HasBids: { title: "The auction already has bids", detail: "You can only cancel before the first bid." },
  AlreadyRegistered: { title: "Participation already registered", detail: "Your wallet is already registered in this auction." },
  NotRegistered: { title: "Wallet not registered in the auction", detail: "Preparing a bid registers your wallet automatically." },
  NotEligible: { title: "Wallet not eligible", detail: "The eligibility policy is not available in this version." },
  MarketFull: { title: "8-bid limit reached", detail: "This auction does not accept new bids." },
  AlreadyBid: { title: "You already placed a bid", detail: "Each wallet can place one bid per auction." },
  ZeroQuantity: { title: "Invalid quantity", detail: "Enter a whole number of quotas greater than zero." },
  NullifierUsed: { title: "Bid already used", detail: "This bid was already submitted. Prepare a new one if possible." },
  NoTrustline: { title: "Quota asset not enabled", detail: "Enable the asset in your wallet to receive quotas.", recovery: { kind: "change_trust", action: "Enable quota" } },
  NoCollateral: { title: "No locked collateral", detail: "There is no locked value for this bid." },
  CollateralExpiresTooSoon: { title: "Delegation expires too soon", detail: "The deadline is recalculated during preparation. Try again.", recovery: retry() },
  InvalidBidProof: { title: "Invalid bid proof", detail: "Nothing was locked. Reload the page and prepare the bid again." },
  InvalidAllocationLength: { title: "Allocation has an invalid length", detail: "The allocation sent by the operator does not match the bids." },
  FillExceedsRequest: { title: "Allocation exceeds the request", detail: "The operator's allocation is not valid." },
  InvalidAllocationProof: { title: "Invalid allocation proof", detail: "The operator must redo the allocation." },
  BidNotFound: { title: "Bid not found", detail: "Your wallet has no bid in this auction." },
  InvalidTransferData: { title: "Invalid settlement data", detail: "The operator must redo this bid's settlement." },
  InvalidSettlementProof: { title: "Invalid settlement proof", detail: "The operator must redo the settlement." },
  DelegationStillActive: { title: "Delegation still active", detail: "Recover the collateral before placing another bid.", recovery: { kind: "revoke_spender", action: "Recover collateral" } },
  BidAlreadyClosed: { title: "Bid already closed", detail: "There is nothing left to do with this bid." },
};

const FACTORY_MESSAGES: Record<string, Translation> = {
  MarketNotFound: { title: "Auction not found", detail: "Check the address or go back to the auction list." },
  MarketIdOverflow: { title: "Auction limit reached", detail: "The factory does not accept more market identifiers." },
  InvalidTotalQuotas: AUCTION_MESSAGES["InvalidTotalQuotas"]!,
  InvalidMinPrice: AUCTION_MESSAGES["InvalidMinPrice"]!,
  InvalidCloseLedger: AUCTION_MESSAGES["InvalidCloseLedger"]!,
  DurationTooLong: AUCTION_MESSAGES["DurationTooLong"]!,
  InvalidFeeReserve: AUCTION_MESSAGES["InvalidFeeReserve"]!,
  SellerNotRegistered: { title: "Confidential account required", detail: "Create your confidential account before selling quotas.", recovery: setup() },
  FeeWalletNotRegistered: { title: "Fee wallet not registered", detail: "The platform configuration is incomplete; notify the operator." },
  InvalidFinalizationGrace: { title: "Invalid finalization grace", detail: "The platform configuration is outside the allowed range." },
};

const TOKEN_MESSAGES: Record<string, Translation> = {
  AccountAlreadyRegistered: { title: "Confidential account already registered", detail: "Your account already exists in this browser. Continue to your wallet." },
  AccountNotRegistered: { title: "Confidential account not registered", detail: "Create the confidential account to move balance.", recovery: setup() },
  NegativeAmount: { title: "Negative amount", detail: "Enter a value greater than zero." },
  DelegationAlreadyExists: { title: "A locked value already exists", detail: "Recover the collateral from the previous auction before placing another bid.", recovery: { kind: "revoke_spender", action: "Recover collateral" } },
  DelegationNotFound: { title: "Delegation not found", detail: "There is no locked collateral to return in this auction." },
  DelegationExpired: { title: "Delegation expired", detail: "The value can already be recovered.", recovery: { kind: "revoke_spender", action: "Recover collateral" } },
  InvalidProof: { title: "Invalid proof", detail: "The operation was not accepted. Try again." },
  InvalidData: { title: "Invalid data", detail: "The operation was not accepted. Refresh the page and try again." },
  UnderlyingAssetNotSet: { title: "Token asset not set", detail: "The platform configuration is incomplete." },
  VerifierNotSet: { title: "Verifier not set", detail: "The platform configuration is incomplete." },
  AuditorNotSet: { title: "Auditor not set", detail: "The platform configuration is incomplete." },
  AddressAsFieldNotSet: { title: "Token address not set", detail: "The platform configuration is incomplete." },
  AddressAsFieldAlreadySet: { title: "Token address already set", detail: "The platform configuration was already initialized." },
  UnderlyingAssetAlreadySet: { title: "Token asset already set", detail: "The platform configuration was already initialized." },
  NonCanonicalEncoding: { title: "Invalid encoding", detail: "Refresh the page and try again." },
};

const LOCAL_MESSAGES: Record<string, Translation> = {
  ProofFailed: { title: "Proof failed", detail: "Nothing was locked. Reload the page and prepare the bid again.", recovery: retry() },
  ArtifactNotFound: { title: "Missing circuit", detail: "The proof files did not load. Refresh the page.", recovery: retry() },
  ArtifactMismatch: { title: "Mismatched proof files", detail: "The app will not generate proofs with files that do not match. Notify the operator." },
  KeyAlreadyExists: { title: "Key already exists in this browser", detail: "Use the existing key or import its backup." },
  KeyNotFound: { title: "Key not found", detail: "Create the confidential account or import your backup.", recovery: { kind: "import_backup", action: "Import backup" } },
  InvalidBackup: { title: "Invalid backup", detail: "Wrong password, another network, or a corrupted file. Nothing was changed." },
  NetworkMismatch: { title: "Wrong network", detail: "Switch the wallet and the app to Testnet and try again." },
  ResourceContention: { title: "Network busy", detail: "The operation competed for resources. Try again.", recovery: retry() },
  TxFailed: { title: "Transaction not confirmed", detail: "Nothing was changed. Try again; if it persists, refresh the balance.", recovery: retry() },
  PriceOutOfRange: { title: "Price out of range", detail: "The price must be between 1 stroop and 2⁶³−1." },
  BelowMinPrice: { title: "Below the floor price", detail: "Raise the price per quota to at least the auction floor." },
  MarketNotOpen: { title: "Auction is not open", detail: "Wait for it to open or choose another auction." },
  BiddingClosed: AUCTION_MESSAGES["BiddingClosed"]!,
  MarketFull: AUCTION_MESSAGES["MarketFull"]!,
  AlreadyBid: AUCTION_MESSAGES["AlreadyBid"]!,
  NoTrustline: AUCTION_MESSAGES["NoTrustline"]!,
  InsufficientBalance: { title: "Insufficient balance", detail: "Deposit XLM into the confidential account before bidding.", recovery: deposit() },
  BalanceOutOfSync: { title: "Balance out of sync", detail: "The activity is older than the RPC window (~7 days). Import a recent backup to reopen the balance.", recovery: { kind: "import_backup", action: "Import backup" } },
  CollateralMismatch: { title: "Mismatched collateral", detail: "The locked value does not match. Recover the collateral and prepare the bid again.", recovery: { kind: "revoke_spender", action: "Recover collateral" } },
  OpeningMismatch: { title: "Mismatched balance opening", detail: "Import a recent backup to resync the balance.", recovery: { kind: "import_backup", action: "Import backup" } },
  RootMismatch: { title: "Mismatched commitments root", detail: "The network changed since preparation. Prepare the bid again." },
  UnsupportedContractsVersion: { title: "Unsupported contracts version", detail: "The app must be updated for this network's version." },
};

const WALLET_MESSAGES: Record<string, Translation> = {
  userRejected: { title: "Signature declined", detail: "Nothing was sent. Try again whenever you're ready." },
  notInstalled: { title: "Freighter not found", detail: "Install the Freighter extension and reload the page." },
  unavailable: { title: "Wallet unavailable", detail: "The extension did not respond. Reload the page and try again." },
  network: { title: "Wrong network in wallet", detail: "Switch Freighter to Testnet and try again." },
};

const FALLBACK_DETAIL = "The operation could not be completed. Try again.";

function recoveryFor(kind: CmiRecovery | undefined): Recovery | undefined {
  switch (kind) {
    case "change_trust":
      return { kind: "change_trust", action: "Enable quota" };
    case "revoke_spender":
      return { kind: "revoke_spender", action: "Recover collateral" };
    case "retry_next_ledger":
      return { kind: "retry", action: "Try next ledger" };
    case "refresh_and_retry":
      return { kind: "retry", action: "Refresh and try again" };
    default:
      return undefined;
  }
}

export function errorText(code: string): ErrorText {
  const [prefix, name] = code.includes(".") ? code.split(".", 2) : [undefined, code];
  const table =
    prefix === "Auction" ? AUCTION_MESSAGES : prefix === "Factory" ? FACTORY_MESSAGES : prefix === "Token" ? TOKEN_MESSAGES : LOCAL_MESSAGES;

  const translation = name === undefined ? undefined : (table[name] ?? LOCAL_MESSAGES[name]);
  if (translation === undefined) return { title: "Could not complete", detail: FALLBACK_DETAIL, code };
  return { ...translation, code };
}

function walletMessage(error: unknown): Translation | undefined {
  if (!(error instanceof Error)) return undefined;
  const text = error.message.toLowerCase();
  if (/declin|denied|reject|cancel/.test(text)) return WALLET_MESSAGES["userRejected"];
  if (/not installed|not available|cannot find|extension/.test(text)) return WALLET_MESSAGES["notInstalled"];
  if (/network|passphrase/.test(text)) return WALLET_MESSAGES["network"];
  return undefined;
}

export function errorTextFrom(error: unknown): ErrorText {
  if (error instanceof CmiError) {
    const base = errorText(error.code);
    const recovery = base.recovery ?? recoveryFor(error.recovery);
    return recovery === undefined ? base : { ...base, recovery };
  }
  const wallet = walletMessage(error);
  if (wallet !== undefined) return { ...wallet };
  if (error instanceof TypeError && /fetch|network|load/i.test(error.message)) {
    return { title: "The network did not respond", detail: "Check your connection and try again. Nothing was sent." };
  }
  return { title: "Could not complete", detail: FALLBACK_DETAIL };
}

export const allLocalCodes: readonly string[] = Object.freeze(Object.keys(LOCAL_MESSAGES));

export function isUserRejection(error: unknown): boolean {
  return error instanceof Error && /declin|denied|reject|cancel/i.test(error.message);
}
