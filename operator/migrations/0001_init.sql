CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE markets (
  market_id            TEXT PRIMARY KEY,
  address              TEXT NOT NULL UNIQUE,
  seller               TEXT NOT NULL,
  quota_asset          TEXT NOT NULL,
  total_quotas         INTEGER NOT NULL,
  min_price_per_quota  TEXT NOT NULL,
  close_ledger         INTEGER NOT NULL,
  grace_ledgers        INTEGER NOT NULL,
  finalize_by_ledger   INTEGER NOT NULL,
  status               TEXT NOT NULL,
  bid_count            INTEGER NOT NULL DEFAULT 0,
  unsold               INTEGER,
  contracts_version    TEXT,
  supported            INTEGER NOT NULL,
  next_check_ledger    INTEGER,
  backoff_attempts     INTEGER NOT NULL DEFAULT 0,
  last_synced_ledger   INTEGER,
  discovered_at        TEXT NOT NULL,
  terminal_at          TEXT
);
CREATE INDEX markets_due ON markets(next_check_ledger) WHERE next_check_ledger IS NOT NULL;

CREATE TABLE bids (
  market_id          TEXT NOT NULL REFERENCES markets(market_id),
  bid_index          INTEGER NOT NULL,
  bidder             TEXT NOT NULL,
  participant_id     INTEGER NOT NULL,
  requested_quantity INTEGER NOT NULL,
  filled_quantity    INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL,
  delegation_live    INTEGER,
  quarantined        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (market_id, bid_index)
);

CREATE TABLE actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,
  bid_index   INTEGER,
  ledger      INTEGER NOT NULL,
  outcome     TEXT NOT NULL,
  code        TEXT,
  tx_hash     TEXT,
  fee_charged TEXT,
  cpu_insns   INTEGER,
  at          TEXT NOT NULL
);
CREATE INDEX actions_market ON actions(market_id, id);

CREATE TABLE alerts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  severity  TEXT NOT NULL,
  kind      TEXT NOT NULL,
  market_id TEXT,
  bid_index INTEGER,
  message   TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  at        TEXT NOT NULL,
  acked_at  TEXT
);
CREATE UNIQUE INDEX alerts_open_dedup ON alerts(dedup_key) WHERE acked_at IS NULL;

CREATE TABLE keys (
  name       TEXT PRIMARY KEY,
  public     TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  iv         BLOB NOT NULL,
  tag        BLOB NOT NULL,
  created_at TEXT NOT NULL
);
