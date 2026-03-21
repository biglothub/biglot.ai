-- Price Alerts — T-401

CREATE TABLE IF NOT EXISTS price_alerts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL,
    symbol      TEXT NOT NULL,
    condition   TEXT NOT NULL CHECK (condition IN ('above', 'below', 'crosses')),
    target      NUMERIC NOT NULL,
    note        TEXT,
    triggered   BOOLEAN NOT NULL DEFAULT false,
    triggered_at TIMESTAMPTZ,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS price_alerts_user_id_idx ON price_alerts(user_id);
CREATE INDEX IF NOT EXISTS price_alerts_active_idx ON price_alerts(active, triggered);
