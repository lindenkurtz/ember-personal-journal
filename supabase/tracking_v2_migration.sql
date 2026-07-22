-- Ember — tracking v2 migration (July 2026).
-- Retires deep-work tracking (columns and historical data are KEPT — nothing here
-- drops, renames, or rewrites existing rows) and adds meal timing, confound flags,
-- focused_work, context_periods, screen_time, and the weekly Sunday push.
-- Idempotent: safe to paste into the Supabase SQL editor more than once.
-- RLS per CLAUDE.md: the SPA is `anon` and needs SELECT + INSERT + UPDATE on every
-- table it writes (upsert().select() does a post-write SELECT); the cron Worker
-- uses the secret key and bypasses RLS.

-- ---------------------------------------------------------------------------
-- entries — new nullable columns. No defaults: historical NULL = "untracked",
-- which the Patterns prompt distinguishes from an explicit false.
-- ---------------------------------------------------------------------------
alter table public.entries add column if not exists last_meal_start_time time;  -- when the last meal of the day STARTED

alter table public.entries add column if not exists sick               boolean;
alter table public.entries add column if not exists alcohol            boolean;
alter table public.entries add column if not exists slept_away         boolean;  -- the night ending this morning (same row-date semantics as the sleep fields)
alter table public.entries add column if not exists travel_day         boolean;  -- 3+ hours in transit today
alter table public.entries add column if not exists caffeine_late      boolean;  -- caffeine after ~2pm today
alter table public.entries add column if not exists deadline_pressure  boolean;  -- exam or major deadline within 48h

alter table public.entries add column if not exists focused_work text
  check (focused_work in ('none', 'light', 'solid', 'deep'));  -- asked from 2026-08-15

-- ---------------------------------------------------------------------------
-- context_periods — non-overlapping life-context ranges. end_date null = active.
-- The EXCLUDE constraint uses the built-in gist opclass for range types (no
-- btree_gist needed — that's only for scalar columns mixed into an exclusion).
-- daterange(start, NULL, '[]') is unbounded above, so the active period blocks
-- any overlapping insert. Bounds are inclusive: a new period must start the
-- DAY AFTER the previous one's end_date.
-- ---------------------------------------------------------------------------
create table if not exists public.context_periods (
  id         bigint generated always as identity primary key,
  label      text not null unique,
  start_date date not null,
  end_date   date,  -- null = currently active
  created_at timestamptz not null default now(),
  constraint context_periods_valid_range
    check (end_date is null or end_date >= start_date),
  constraint context_periods_no_overlap
    exclude using gist (daterange(start_date, end_date, '[]') with &&)
);
alter table public.context_periods enable row level security;
drop policy if exists "anon read context_periods"   on public.context_periods;
drop policy if exists "anon insert context_periods" on public.context_periods;
drop policy if exists "anon update context_periods" on public.context_periods;
drop policy if exists "anon delete context_periods" on public.context_periods;
create policy "anon read context_periods"   on public.context_periods for select to anon using (true);
create policy "anon insert context_periods" on public.context_periods for insert to anon with check (true);
create policy "anon update context_periods" on public.context_periods for update to anon using (true) with check (true);
create policy "anon delete context_periods" on public.context_periods for delete to anon using (true);

-- Bare ON CONFLICT DO NOTHING (no target) also arbitrates the exclusion
-- constraint, so this seed can never fail on a re-run (duplicate label or
-- overlapping range → silently skipped).
insert into public.context_periods (label, start_date, end_date)
values ('summer_2026', '2026-05-14', null)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- screen_time — one row per day, entered weekly on /screentime. All values
-- nullable: blank cells are never written; partial weeks are normal.
-- ---------------------------------------------------------------------------
create table if not exists public.screen_time (
  date             date primary key,
  phone_minutes    integer check (phone_minutes between 0 and 1440),    -- iPhone, Social + Entertainment categories only
  phone_pickups    integer check (phone_pickups >= 0),                  -- iPhone
  computer_minutes integer check (computer_minutes between 0 and 1440), -- Mac + iPad combined
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
drop trigger if exists screen_time_set_updated_at on public.screen_time;
create trigger screen_time_set_updated_at
before update on public.screen_time
for each row execute function public.set_updated_at();

alter table public.screen_time enable row level security;
drop policy if exists "anon read screen_time"   on public.screen_time;
drop policy if exists "anon insert screen_time" on public.screen_time;
drop policy if exists "anon update screen_time" on public.screen_time;
create policy "anon read screen_time"   on public.screen_time for select to anon using (true);
create policy "anon insert screen_time" on public.screen_time for insert to anon with check (true);
create policy "anon update screen_time" on public.screen_time for update to anon using (true) with check (true);

-- ---------------------------------------------------------------------------
-- push_settings — weekly Sunday screen-time reminder. The deep_work_rest_budget*
-- columns are intentionally NOT dropped; the app just stops selecting them.
-- ---------------------------------------------------------------------------
alter table public.push_settings add column if not exists weekly_time      text not null default '21:00';
alter table public.push_settings add column if not exists last_weekly_sent date;
