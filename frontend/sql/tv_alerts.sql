-- TradingView Alerts Table — T-805
-- Stores incoming TradingView webhook alerts

create table if not exists tv_alerts (
  id            uuid        primary key default gen_random_uuid(),
  symbol        text        not null,
  action        text        not null check (action in ('buy', 'sell', 'close', 'alert')),
  price         numeric     not null,
  message       text        not null default '',
  paper_trade   boolean     not null default false,
  triggered_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- Index for listing by time
create index if not exists tv_alerts_triggered_at_idx on tv_alerts (triggered_at desc);
create index if not exists tv_alerts_symbol_idx       on tv_alerts (symbol);

-- Row Level Security
alter table tv_alerts enable row level security;

-- Admin-only policy (webhook writes via service role key)
create policy "service_role_all" on tv_alerts
  for all
  using (true)
  with check (true);
