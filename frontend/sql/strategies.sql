-- Strategy Definition Schema - T-103
-- Stores trading strategy definitions with conditions, sizing, and risk params

create table if not exists strategies (
    id              uuid        primary key default gen_random_uuid(),
    biglot_user_id  text        not null,
    name            text        not null check (char_length(name) between 1 and 100),
    description     text,
    version         integer     not null default 1 check (version >= 1),
    is_active       boolean     not null default true,
    -- Full strategy definition (entry, exit, positionSizing, risk, assetFilter)
    definition      jsonb       not null,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- Index for fast per-user lookups
create index if not exists strategies_biglot_user_id_idx on strategies (biglot_user_id);

-- Index for active strategies (used by scanner)
create index if not exists strategies_active_idx on strategies (biglot_user_id, is_active)
    where is_active = true;

-- Auto-update updated_at on row change
create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists strategies_updated_at on strategies;
create trigger strategies_updated_at
    before update on strategies
    for each row execute function update_updated_at_column();

-- Row-Level Security (bypassed by service role key used server-side)
alter table strategies enable row level security;

create policy "Users can read own strategies"
    on strategies for select
    using (biglot_user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub'));

create policy "Users can create own strategies"
    on strategies for insert
    with check (biglot_user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub'));

create policy "Users can update own strategies"
    on strategies for update
    using (biglot_user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub'));

create policy "Users can delete own strategies"
    on strategies for delete
    using (biglot_user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub'));
