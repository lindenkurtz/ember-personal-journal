-- Ember — finance feature schema.
-- Run in the Supabase SQL editor. Idempotent and safe to re-run: every policy is
-- preceded by `drop policy if exists` because Postgres has no
-- `create policy if not exists`, so a bare re-run fails with 42710.
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
--
-- RETIRED (Sept 2026) — data is permanent, same rule as the deep_work_* columns.
-- Transaction ingest, classification, screenshot import, the review queue,
-- user rules, the monthly cash-flow / category panels and savings-rate tracking
-- were all removed from the app. Their tables and columns stay here and keep
-- every row they hold; nothing reads or writes them any more. Do not drop them,
-- rewrite them, or repurpose the columns.
--   * `finance_transactions`, `finance_rules` — retired wholesale.
--   * `finance_plaid_items.transactions_cursor` — no longer read or advanced.
--   * `finance_settings.brokerage_match`, `.cc_payment_payee` — classification
--     config with no remaining consumer.
-- Still live: finance_accounts, finance_balances, finance_net_worth_snapshots,
-- finance_loan_balances, finance_settings (plaid_env, loan_servicer,
-- last_full_sync_date), and finance_plaid_items itself.

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
drop policy if exists "anon read accounts" on finance_accounts;
create policy "anon read accounts"   on finance_accounts for select to anon using (true);
-- INSERT is retained for the retired client-created synthetic account rows.
drop policy if exists "anon insert accounts" on finance_accounts;
create policy "anon insert accounts" on finance_accounts for insert to anon with check (true);
drop policy if exists "anon update accounts" on finance_accounts;
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
  savings_bucket text, -- 'short_term' | 'long_term' | 'retirement' | null
  income_source text,  -- free-text payer label for the income stack; null = Misc
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
drop policy if exists "anon read txns" on finance_transactions;
create policy "anon read txns"   on finance_transactions for select to anon using (true);
drop policy if exists "anon insert txns" on finance_transactions;
create policy "anon insert txns" on finance_transactions for insert to anon with check (true);
drop policy if exists "anon update txns" on finance_transactions;
create policy "anon update txns" on finance_transactions for update to anon using (true) with check (true);
drop policy if exists "anon delete txns" on finance_transactions;
create policy "anon delete txns" on finance_transactions for delete to anon using (true);
-- Idempotent: adds the savings bucket to an already-created table on re-run.
alter table finance_transactions add column if not exists savings_bucket text;
-- Idempotent: adds the income source label on re-run.
alter table finance_transactions add column if not exists income_source text;

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
drop policy if exists "anon read balances" on finance_balances;
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
drop policy if exists "anon read snapshots" on finance_net_worth_snapshots;
create policy "anon read snapshots" on finance_net_worth_snapshots for select to anon using (true);

-- ---------------------------------------------------------------------------
-- finance_loan_balances — one row per servicer per day. Written by Plaid
-- Liabilities or manually from /finance. `servicer` is the display name AND the
-- upsert key, and the net-worth rollup sums the latest balance per distinct
-- servicer — so renaming one strands its old rows and double-counts the loan.
-- ---------------------------------------------------------------------------
create table if not exists finance_loan_balances (
  id bigint generated always as identity primary key,
  as_of date not null,
  servicer text not null,
  balance numeric not null,
  source text not null default 'manual',
  unique (servicer, as_of)
);
create index if not exists finance_loan_balances_date_idx on finance_loan_balances (as_of desc);
alter table finance_loan_balances enable row level security;
drop policy if exists "anon read loans" on finance_loan_balances;
create policy "anon read loans"   on finance_loan_balances for select to anon using (true);
drop policy if exists "anon insert loans" on finance_loan_balances;
create policy "anon insert loans" on finance_loan_balances for insert to anon with check (true);
drop policy if exists "anon update loans" on finance_loan_balances;
create policy "anon update loans" on finance_loan_balances for update to anon using (true) with check (true);
drop policy if exists "anon delete loans" on finance_loan_balances;
create policy "anon delete loans" on finance_loan_balances for delete to anon using (true);

-- ---------------------------------------------------------------------------
-- finance_settings — singleton (id = 1).
-- ---------------------------------------------------------------------------
create table if not exists finance_settings (
  id smallint primary key default 1,
  plaid_env text not null default 'sandbox',
  cc_payment_payee text,
  -- Comma-separated substrings naming the external brokerage/savings institution
  -- transfers are bound for. Null = no brokerage configured; the classifier's
  -- brokerage branches don't fire. Kept here so no institution is named in code.
  brokerage_match text,
  -- Display name of the loan servicer in finance_loan_balances. Null = no loan
  -- tracked, and the Plaid liabilities write is skipped rather than inventing a
  -- name that would not match existing rows.
  loan_servicer text,
  -- Semester start dates (JSON array of 'YYYY-MM-DD' strings, any order) that
  -- drive the Dashboard's "update your loan balance" card: one nag per term,
  -- clearing as soon as a finance_loan_balances row is written on or after that
  -- date. Null or [] = the card never appears. This is deliberately data and
  -- not a constant — an academic calendar identifies a school, and this repo is
  -- public. The list also encodes when the reminders stop: after the last entry
  -- is satisfied there is nothing left to nag about.
  semester_starts jsonb,
  last_full_sync_date date,
  constraint finance_settings_singleton check (id = 1)
);
insert into finance_settings (id) values (1) on conflict (id) do nothing;

-- Backfill for databases created before these columns existed. Idempotent.
alter table finance_settings add column if not exists brokerage_match text;
alter table finance_settings add column if not exists loan_servicer text;
alter table finance_settings add column if not exists semester_starts jsonb;

-- Adopt the servicer name already present in the data, so upgrading doesn't
-- strand existing loan rows under a name the app no longer knows.
update finance_settings
   set loan_servicer = (select servicer from finance_loan_balances order by as_of desc limit 1)
 where loan_servicer is null;

-- Two per-account buffer-target columns were dropped from this definition: never
-- read by the app, and named after specific institutions. Any existing columns
-- are left in place (same rule as the retired deep_work_* columns) — nothing
-- selects them, so they're inert.
alter table finance_settings enable row level security;
drop policy if exists "anon read settings" on finance_settings;
create policy "anon read settings"   on finance_settings for select to anon using (true);
drop policy if exists "anon insert settings" on finance_settings;
create policy "anon insert settings" on finance_settings for insert to anon with check (true);
drop policy if exists "anon update settings" on finance_settings;
create policy "anon update settings" on finance_settings for update to anon using (true) with check (true);

-- ---------------------------------------------------------------------------
-- finance_rules — user-defined classification rules. Created from a single
-- transaction in the editor ("always classify X as …") and applied to every
-- future matching transaction on the next Plaid sync or screenshot import.
-- `match_text` is a lowercased substring matched against merchant_name + name.
-- ---------------------------------------------------------------------------
create table if not exists finance_rules (
  id bigint generated always as identity primary key,
  match_text text not null,
  category text not null,
  note text,                 -- stamped onto notes (e.g. 'Credit Card Payment')
  savings_bucket text,       -- 'short_term' | 'long_term' | 'retirement' | null
  income_source text,        -- stamped onto income_source (e.g. 'AcmeCorp')
  created_at timestamptz not null default now()
);
create index if not exists finance_rules_created_idx on finance_rules (created_at desc);
-- Idempotent: adds the income source label to an already-created rules table.
alter table finance_rules add column if not exists income_source text;
alter table finance_rules enable row level security;
drop policy if exists "anon read rules" on finance_rules;
create policy "anon read rules"   on finance_rules for select to anon using (true);
drop policy if exists "anon insert rules" on finance_rules;
create policy "anon insert rules" on finance_rules for insert to anon with check (true);
drop policy if exists "anon update rules" on finance_rules;
create policy "anon update rules" on finance_rules for update to anon using (true) with check (true);
drop policy if exists "anon delete rules" on finance_rules;
create policy "anon delete rules" on finance_rules for delete to anon using (true);
