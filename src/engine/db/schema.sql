-- SQL schema for OmniTrader database
-- This file is used by database.js migrateSchema() for fresh database initialization

-- Enable foreign keys support
PRAGMA foreign_keys = ON;

-- Users table for authentication and user management
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  telegram_chat_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Exchange accounts table (supports multiple exchanges via CCXT)
CREATE TABLE IF NOT EXISTS exchange_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exchange TEXT NOT NULL,  -- bybit, hyperliquid, etc.
  label TEXT NOT NULL,
  api_key_enc TEXT NOT NULL,
  api_secret_enc TEXT NOT NULL,
  is_testnet INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

-- Trading setups (configurations for automated trading)
CREATE TABLE IF NOT EXISTS trading_setups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exchange_account_id INTEGER NOT NULL REFERENCES exchange_accounts(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  memo TEXT,
  activation_price REAL NOT NULL,
  ignore_box_upper REAL NOT NULL,
  ignore_box_lower REAL NOT NULL,
  entry_indicator_type TEXT NOT NULL,
  entry_indicator_tf TEXT NOT NULL,
  risk_type TEXT NOT NULL,
  risk_value REAL NOT NULL,
  sl_price REAL DEFAULT 0,
  sl_type TEXT,
  sl_percent REAL DEFAULT 2.0,
  tp_prices TEXT DEFAULT '[1,2,3,4]',
  be_enabled INTEGER DEFAULT 0,
  be_trigger_price REAL DEFAULT 0,
  be_activated INTEGER DEFAULT 0,
  entry_price REAL,
  entry_qty REAL,
  activated_at TEXT,
  exit_indicator_type TEXT,
  exit_indicator_tf TEXT,
  closed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  profit REAL DEFAULT 0,
  reason TEXT DEFAULT ''
);

-- Orders created for trading setups
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setup_id INTEGER NOT NULL REFERENCES trading_setups(id) ON DELETE CASCADE,
  order_type TEXT NOT NULL,
  side TEXT NOT NULL,
  price REAL NOT NULL,
  qty REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  exchange_order_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Migration tracking table
CREATE TABLE IF NOT EXISTS _migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_exchange_accounts_user ON exchange_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_setups_user_created ON trading_setups(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_setups_status ON trading_setups(status);
CREATE INDEX IF NOT EXISTS idx_setups_account ON trading_setups(exchange_account_id);
CREATE INDEX IF NOT EXISTS idx_orders_setup ON orders(setup_id);

-- Screener items for monitoring reversals
CREATE TABLE IF NOT EXISTS screener_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exchange_account_id INTEGER NOT NULL REFERENCES exchange_accounts(id) ON DELETE CASCADE,
  symbol             TEXT NOT NULL,
  timeframe          TEXT NOT NULL,
  indicator_type     TEXT NOT NULL,
  indicator_params   TEXT DEFAULT '{}',
  enabled            INTEGER NOT NULL DEFAULT 1,
  last_signal        TEXT,
  last_checked_at    TEXT,
  last_alerted_at    TEXT,
  created_at         TEXT DEFAULT (datetime('now')),
  updated_at         TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_screener_user_enabled ON screener_items(user_id, enabled);
CREATE INDEX IF NOT EXISTS idx_screener_symbol_tf ON screener_items(symbol, timeframe);

-- Supply/demand screener items for monitoring supply/demand zones
CREATE TABLE IF NOT EXISTS supply_demand_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exchange_account_id INTEGER NOT NULL REFERENCES exchange_accounts(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  indicator_type TEXT NOT NULL DEFAULT 'supply_demand', -- fixed type
  indicator_params TEXT DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_signal TEXT, -- supply/demand/null
  last_zone_price REAL, -- detected zone price (midpoint)
  last_zone_top REAL, -- top price of zone
  last_zone_bottom REAL, -- bottom price of zone
  last_zone_timeframe TEXT, -- timeframe where zone detected (4H, 2H, etc)
  last_checked_at TEXT,
  last_alerted_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_supply_demand_user_enabled ON supply_demand_items(user_id, enabled);
CREATE INDEX IF NOT EXISTS idx_supply_demand_symbol_tf ON supply_demand_items(symbol, timeframe);

-- Migration: remove old tables if they exist
DROP TABLE IF EXISTS screener_items;
DROP TABLE IF EXISTS supply_demand_items;

-- Screener snapshot for all-assets real-time signals
CREATE TABLE IF NOT EXISTS screener_snapshot (
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  indicator_type TEXT NOT NULL,
  signal TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (symbol, timeframe, indicator_type)
);
CREATE INDEX IF NOT EXISTS idx_screener_snapshot_type ON screener_snapshot(indicator_type);

-- Per-user EW screener telegram subscriptions
CREATE TABLE IF NOT EXISTS ew_screener_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  timeframe TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, timeframe)
);
CREATE INDEX IF NOT EXISTS idx_ew_sub_user ON ew_screener_subscriptions(user_id);

-- User price-level alarms (Bybit closed-candle based)
CREATE TABLE IF NOT EXISTS price_alarms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  direction TEXT NOT NULL,
  price_level REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_price_alarms_user ON price_alarms(user_id);
CREATE INDEX IF NOT EXISTS idx_price_alarms_lookup ON price_alarms(symbol, timeframe);

-- Per-user MA Z-Score timeframe subscriptions
CREATE TABLE IF NOT EXISTS mazscore_tf_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  timeframe TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, timeframe)
);
CREATE INDEX IF NOT EXISTS idx_mazscore_tf_user ON mazscore_tf_subscriptions(user_id);

-- Per-user MA Z-Score asset subscriptions
CREATE TABLE IF NOT EXISTS mazscore_asset_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, symbol)
);
CREATE INDEX IF NOT EXISTS idx_mazscore_asset_user ON mazscore_asset_subscriptions(user_id);