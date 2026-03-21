-- Portfolio Tracker — T-302
-- Run this in Supabase SQL Editor

-- Open positions table
CREATE TABLE IF NOT EXISTS portfolio_positions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL,
    symbol      TEXT NOT NULL,
    direction   TEXT NOT NULL CHECK (direction IN ('long', 'short')),
    entry_price NUMERIC(20, 8) NOT NULL,
    size        NUMERIC(20, 8) NOT NULL,
    stop_price  NUMERIC(20, 8),
    target_price NUMERIC(20, 8),
    notes       TEXT,
    opened_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS portfolio_positions_user_id ON portfolio_positions (user_id);

-- Closed trades table
CREATE TABLE IF NOT EXISTS portfolio_closed_trades (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL,
    symbol      TEXT NOT NULL,
    direction   TEXT NOT NULL CHECK (direction IN ('long', 'short')),
    entry_price NUMERIC(20, 8) NOT NULL,
    exit_price  NUMERIC(20, 8) NOT NULL,
    size        NUMERIC(20, 8) NOT NULL,
    pnl_usd     NUMERIC(20, 8) NOT NULL,
    r_multiple  NUMERIC(10, 4),
    notes       TEXT,
    opened_at   TIMESTAMPTZ NOT NULL,
    closed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS portfolio_closed_trades_user_id ON portfolio_closed_trades (user_id);
CREATE INDEX IF NOT EXISTS portfolio_closed_trades_closed_at ON portfolio_closed_trades (closed_at DESC);

-- RLS policies (enable if using Supabase auth)
-- ALTER TABLE portfolio_positions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE portfolio_closed_trades ENABLE ROW LEVEL SECURITY;
