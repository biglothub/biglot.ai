-- Strategy Marketplace — T-504
-- Allows users to publish strategies and fork community strategies

-- ─── Published strategies ─────────────────────────────────────────────────────

create table if not exists published_strategies (
    id                  uuid        primary key default gen_random_uuid(),
    strategy_id         uuid        not null,          -- original private strategy
    author_user_id      text        not null,
    title               text        not null check (char_length(title) between 1 and 100),
    description         text,
    tags                text[]      not null default '{}',
    fork_count          integer     not null default 0 check (fork_count >= 0),
    avg_rating          numeric(3,2)         default null,  -- recomputed on each rating
    rating_count        integer     not null default 0 check (rating_count >= 0),
    definition          jsonb       not null,          -- snapshot of strategy at publish time
    created_at          timestamptz not null default now()
);

create index if not exists published_strategies_author_idx
    on published_strategies (author_user_id);

create index if not exists published_strategies_created_idx
    on published_strategies (created_at desc);

-- Ensure an author can only publish a given strategy_id once
create unique index if not exists published_strategies_unique_pub
    on published_strategies (strategy_id, author_user_id);

-- ─── Ratings ──────────────────────────────────────────────────────────────────

create table if not exists strategy_ratings (
    id                      uuid        primary key default gen_random_uuid(),
    published_strategy_id   uuid        not null references published_strategies (id) on delete cascade,
    user_id                 text        not null,
    rating                  smallint    not null check (rating between 1 and 5),
    review                  text,
    created_at              timestamptz not null default now(),
    unique (published_strategy_id, user_id)
);

create index if not exists strategy_ratings_pub_idx
    on strategy_ratings (published_strategy_id);

-- ─── RLS ──────────────────────────────────────────────────────────────────────

alter table published_strategies enable row level security;
alter table strategy_ratings enable row level security;

-- Anyone can read published strategies
create policy "Anyone can read published strategies"
    on published_strategies for select
    using (true);

-- Authors can insert their own
create policy "Authors can publish their strategies"
    on published_strategies for insert
    with check (author_user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub'));

-- Authors can delete their own
create policy "Authors can unpublish their strategies"
    on published_strategies for delete
    using (author_user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub'));

-- Ratings: anyone can read, users can rate once
create policy "Anyone can read ratings"
    on strategy_ratings for select
    using (true);

create policy "Users can rate strategies"
    on strategy_ratings for insert
    with check (user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub'));

create policy "Users can update own rating"
    on strategy_ratings for update
    using (user_id = (current_setting('request.jwt.claims', true)::json ->> 'sub'));
