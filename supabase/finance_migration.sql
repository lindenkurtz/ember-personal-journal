-- Ember — finance feature schema.
-- Run once in the Supabase SQL editor on the existing project.
--
-- RLS model (mirrors CLAUDE.md):
--   * The SPA authenticates as `anon` (publishable key). Every table the SPA
--     reads/writes needs explicit anon policies for SELECT *and* every write
--     verb used — the supabase-js `.upsert().select()` chain does a post-write
--     SELECT that fails 42501 if the SELECT policy is missing.
--   * The Pages Function and cron Worker use the Supabase *secret* key, which
--     bypasses RLS entirely, so they never need policies.
--   * `finance_plaid_items` holds access tokens and is deliberately given NO
--     anon policy — it is server-only and must never be reachable from the SPA.

-- ---------------------------------------------------------------------------
-- finance_plaid_items — one row per linked Plaid Item. SERVER-ONLY.
-- ---------------------------------------------------------------------------
create table if not exists finance_plaid_items (
  item_id text primary key,
  access_token text not null,
  institution_name text,
  products text[] not null default '{}',
  transactions_cursor text,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
alter table finance_plaid_items enable row level security;
-- Intentionally no policies: anon can do nothing here.

-- ---------------------------------------------------------------------------
-- finance_accounts — account metadata. SPA reads + toggles include/nickname.
-- ---------------------------------------------------------------------------
create table if not exists finance_accounts (
  account_id text primary key,
  item_id text references finance_plaid_items(item_id) on delete cascade,
  name text not null,
  official_name text,
  institution_name text,
  type text,
  subtype text,
  mask text,
  is_asset boolean not null default true,
  include_in_net_worth boolean not null default true,
  source text not null default 'plaid',
  last_synced_at timestamptz
);
alter table finance_accounts enable row level security;
create policy "anon read accounts"   on finance_accounts for select to anon using (true);
-- INSERT is needed for the client-created synthetic Apple Card (CSV) account.
create policy "anon insert accounts" on finance_accounts for insert to anon with check (true);
create policy "anon update accounts" on finance_accounts for update to anon using (true) with check (true);

-- ---------------------------------------------------------------------------
-- finance_transactions — raw + enriched. Fully SPA-editable.
-- amount convention: inflow positive, outflow negative.
-- ---------------------------------------------------------------------------
create table if not exists finance_transactions (
  id text primary key,
  account_id text references finance_accounts(account_id) on delete set null,
  date date not null,
  amount numeric not null,
  merchant_name text,
  name text,
  plaid_category text,
  category text not null default 'shopping',
  notes text,
  is_transfer boolean not null default false,
  is_split boolean not null default false,
  split_amount numeric,
  flagged_for_review boolean not null default false,
  reviewed boolean not null default false,
  source text not null default 'plaid',
  pending boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_transactions_date_idx     on finance_transactions (date desc);
create index if not exists finance_transactions_account_idx  on finance_transactions (account_id);
create index if not exists finance_transactions_review_idx   on finance_transactions (flagged_for_review, reviewed);
alter table finance_transactions enable row level security;
create policy "anon read txns"   on finance_transactions for select to anon using (true);
create policy "anon insert txns" on finance_transactions for insert to anon with check (true);
create policy "anon update txns" on finance_transactions for update to anon using (true) with check (true);
create policy "anon delete txns" on finance_transactions for delete to anon using (true);

-- ---------------------------------------------------------------------------
-- finance_balances — one row per account per sync day (per-account history).
-- ---------------------------------------------------------------------------
create table if not exists finance_balances (
  id bigint generated always as identity primary key,
  account_id text references finance_accounts(account_id) on delete cascade,
  as_of date not null,
  balance numeric not null,
  synced_at timestamptz not null default now(),
  unique (account_id, as_of)
);
create index if not exists finance_balances_acct_date_idx on finance_balances (account_id, as_of desc);
alter table finance_balances enable row level security;
create policy "anon read balances" on finance_balances for select to anon using (true);

-- ---------------------------------------------------------------------------
-- finance_net_worth_snapshots — computed net worth per sync day.
-- ---------------------------------------------------------------------------
create table if not exists finance_net_worth_snapshots (
  as_of date primary key,
  net_worth numeric not null,
  assets_total numeric not null,
  liabilities_total numeric not null,
  synced_at timestamptz not null default now()
);
alter table finance_net_worth_snapshots enable row level security;
create policy "anon read snapshots" on finance_net_worth_snapshots for select to anon using (true);

-- ---------------------------------------------------------------------------
-- finance_loan_balances — Servicer. Written by Plaid Liabilities or manually.
-- ---------------------------------------------------------------------------
create table if not exists finance_loan_balances (
  id bigint generated always as identity primary key,
  as_of date not null,
  servicer text not null default 'Servicer',
  balance numeric not null,
  source text not null default 'manual',
  unique (servicer, as_of)
);
create index if not exists finance_loan_balances_date_idx on finance_loan_balances (as_of desc);
alter table finance_loan_balances enable row level security;
create policy "anon read loans"   on finance_loan_balances for select to anon using (true);
create policy "anon insert loans" on finance_loan_balances for insert to anon with check (true);
create policy "anon update loans" on finance_loan_balances for update to anon using (true) with check (true);
create policy "anon delete loans" on finance_loan_balances for delete to anon using (true);

-- ---------------------------------------------------------------------------
-- finance_settings — singleton (id = 1).
-- ---------------------------------------------------------------------------
create table if not exists finance_settings (
  id smallint primary key default 1,
  plaid_env text not null default 'sandbox',
  cc_payment_payee text,
  wf_buffer_target numeric not null default 100,
  secondary_buffer_target numeric not null default 75,
  last_full_sync_date date,
  constraint finance_settings_singleton check (id = 1)
);
insert into finance_settings (id) values (1) on conflict (id) do nothing;
alter table finance_settings enable row level security;
create policy "anon read settings"   on finance_settings for select to anon using (true);
create policy "anon insert settings" on finance_settings for insert to anon with check (true);
create policy "anon update settings" on finance_settings for update to anon using (true) with check (true);
