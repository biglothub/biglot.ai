-- Trade Journal — T-305
-- Stores per-trade journal entries with notes, emotion, and outcome

CREATE TABLE IF NOT EXISTS trade_journal (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      TEXT NOT NULL,
    symbol       TEXT NOT NULL,
    direction    TEXT NOT NULL CHECK (direction IN ('long', 'short')),
    entry_price  NUMERIC NOT NULL,
    exit_price   NUMERIC,               -- null if still open
    size         NUMERIC NOT NULL,
    pnl_usd      NUMERIC,               -- null if still open
    r_multiple   NUMERIC,
    setup_type   TEXT,                  -- e.g. 'breakout', 'pullback', 'reversal'
    emotion      TEXT CHECK (emotion IN ('calm', 'fearful', 'greedy', 'impulsive', 'disciplined', 'other')),
    pre_notes    TEXT,                  -- notes before entering the trade
    post_notes   TEXT,                  -- notes after exiting / review
    mistakes     TEXT[],               -- array of identified mistake tags
    followed_plan BOOLEAN,
    trade_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS trade_journal_user_id_idx ON trade_journal(user_id);
CREATE INDEX IF NOT EXISTS trade_journal_trade_date_idx ON trade_journal(trade_date DESC);
CREATE INDEX IF NOT EXISTS trade_journal_symbol_idx ON trade_journal(user_id, symbol);
