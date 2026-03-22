-- Paper Trading Engine — T-603
-- Virtual sandbox trades table

CREATE TABLE IF NOT EXISTS paper_trades (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     text        NOT NULL DEFAULT 'default',
    symbol      text        NOT NULL,
    side        text        NOT NULL CHECK (side IN ('long', 'short')),
    qty         numeric(20, 8) NOT NULL CHECK (qty > 0),
    entry_price numeric(20, 8) NOT NULL,
    exit_price  numeric(20, 8),
    pnl         numeric(20, 8),
    is_open     boolean     NOT NULL DEFAULT true,
    notes       text,
    opened_at   timestamptz NOT NULL DEFAULT now(),
    closed_at   timestamptz
);

CREATE INDEX IF NOT EXISTS paper_trades_user_open_idx   ON paper_trades (user_id, is_open);
CREATE INDEX IF NOT EXISTS paper_trades_user_symbol_idx ON paper_trades (user_id, symbol);

ALTER TABLE paper_trades ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (used by server-side admin client)
CREATE POLICY "service_role_paper_trades" ON paper_trades
    USING (true)
    WITH CHECK (true);
