# Ember

A small, private daily journal for tracking sleep, gym, focused work, social
time, meal timing, confounding events, and screen time — plus a personal finance
dashboard at `/finance`. Single-user PWA. Lives behind Cloudflare Access. Built
with React + Vite, Supabase, and the Claude API.

Conventions and the "why" behind the design decisions live in
[CLAUDE.md](CLAUDE.md); finance setup and operations in
[docs/FINANCE.md](docs/FINANCE.md).

## Stack

- **React + Vite** (TypeScript), deployed as a static site to Cloudflare Pages
- **Supabase** for persistence — `entries` (one row per day), `screen_time`,
  `context_periods`, `push_*`, and the `finance_*` tables
- **Anthropic Claude** for the morning nudge, the patterns analysis, and
  screenshot transaction extraction — called through a Cloudflare Pages Function
  so the API key never ships to the browser
- **Plaid** for bank sync, called via raw REST from a Pages Function and the
  cron Worker
- **Plus Jakarta Sans** + warm palette

## Setup

```bash
npm install
cp .env.example .env       # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                # http://localhost:5173
```

`npm run dev` serves the SPA only — anything under `/api/*` (the Claude proxy,
Plaid) 404s. The morning check-in degrades gracefully without it (the nudge is
skipped); Patterns and Finance need the Functions running:

```bash
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .dev.vars
npm run build
npm run pages:dev          # runs wrangler pages dev dist
```

## Supabase schema

Run once in the Supabase SQL editor:

```sql
create table public.entries (
  date              date primary key,
  bedtime           time,
  wake_time         time,           -- user-entered, this morning's wake time (same row-date semantics as bedtime)
  sleep_quality     smallint check (sleep_quality between 1 and 5),
  sleep_hours       numeric(4,2),   -- objective duration in hours from Apple Watch, written by iOS Shortcut
  day_quality       smallint check (day_quality between 1 and 5),
  gym_intention     text check (gym_intention in ('yes','no','rest')),
  gym_actual        text check (gym_actual    in ('yes','no','rest')),
  -- Deep work: retired July 2026. Kept so historical rows and the History page
  -- still render; nothing writes these again. ('rest' above is likewise a legacy
  -- value the app no longer produces — see the gym-streak note in CLAUDE.md.)
  deep_work_target  numeric(4,1),
  deep_work_actual  numeric(4,1),
  deep_work_start   time,
  deep_work_planned text check (deep_work_planned in ('yes','no')),
  deep_work_plan_note text,
  social            boolean,
  note              text,
  -- Passive context (all nullable; the app never writes zero defaults):
  hrv_avg           numeric(5,1),   -- ms, written by external iOS Shortcut
  resting_hr        smallint,       -- bpm, written by external iOS Shortcut
  steps             integer,        -- daily steps, written by external iOS Shortcut
  weather_temp_f    numeric(4,1),   -- °F at morning check-in, written by cron Worker
  weather_code      smallint,       -- Open-Meteo WMO code, written by cron Worker
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger entries_set_updated_at
before update on public.entries
for each row execute function public.set_updated_at();

-- Web Push for daily check-in reminders.
create table public.push_subscriptions (
  endpoint   text primary key,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz default now()
);

create table public.push_settings (
  id                   integer primary key default 1 check (id = 1),
  enabled              boolean not null default true,
  morning_time         text not null default '08:00',
  evening_time         text not null default '21:30',
  timezone             text not null default 'America/Denver',
  last_morning_sent    date,
  last_evening_sent    date,
  -- Gym streak budget (current value) + per-week history so changing the budget
  -- mid-streak doesn't retroactively break past weeks. See `setRestBudget` in
  -- src/lib/settings.ts for the write path and `budgetForWeek` in src/lib/streaks.ts
  -- for the read path.
  rest_days_per_week   smallint not null default 3 check (rest_days_per_week between 0 and 7),
  rest_budget_history  jsonb not null default '[]'::jsonb,
  -- Used by the cron Worker to fetch weather from Open-Meteo:
  latitude             numeric(9,6),
  longitude            numeric(9,6),
  location_name        text,
  updated_at           timestamptz default now()
);

insert into public.push_settings (id) values (1) on conflict do nothing;
```

Then run the three migration files in [supabase/](supabase/), in this order.
All are idempotent and safe to re-run:

1. `tracking_v2_migration.sql` — tracking v2 (July 2026): confound flags,
   `focused_work`, `last_meal_start_time`, the `context_periods` and
   `screen_time` tables, and the weekly-push columns on `push_settings`. Deep
   work was retired at the same time — its columns and historical data stay in
   the DB and are viewable on the History page.
2. `finance_migration.sql` — the `finance_*` tables (see
   [docs/FINANCE.md](docs/FINANCE.md)).
3. `push_rls_migration.sql` — backfills `anon` RLS policies on
   `push_subscriptions` and `push_settings`, which the block above creates
   without them.

RLS is enabled on every table; the SPA's publishable key authenticates as
`anon` and needs explicit SELECT + INSERT + UPDATE policies per table (the
migrations create them). The one exception is `finance_plaid_items`, which holds
Plaid access tokens and deliberately has **no** anon policy. See CLAUDE.md for
the two-key model.

## Deploy (Cloudflare Pages)

1. Connect this repo to Cloudflare Pages.
2. Build command: `npm run build`. Output: `dist`.
3. Environment variables:
   - `VITE_SUPABASE_URL` (Production + Preview) — build-time
   - `VITE_SUPABASE_ANON_KEY` (Production + Preview) — build-time
   - `VITE_VAPID_PUBLIC_KEY` (Production + Preview) — build-time; without it the
     push toggle in Settings stays disabled
   - `ANTHROPIC_API_KEY` (Production + Preview) — runtime, Functions only
   - Plaid + Supabase server vars for `/api/plaid/*` — see docs/FINANCE.md
4. Add the Pages domain to Cloudflare Access (Zero Trust → Access → Applications).

The cron Worker in [worker/](worker/) deploys separately with
`cd worker && npm run deploy`.

## Project structure

```
functions/api/claude.ts   Pages Function — Anthropic proxy (key stays here)
functions/api/plaid/      Pages Functions — Plaid link / exchange / manual sync
shared/finance/           runtime-agnostic finance logic, compiled into the SPA,
                          the Functions, and the Worker
worker/                   separate Cloudflare Worker — 5-min cron: push
                          notifications, weather snapshot, daily Plaid sync
src/lib/                  supabase, entries, screenTime, contextPeriods,
                          settings, push, promptData, claude, date, streaks
src/lib/finance/          SPA-side finance data access + screenshot extraction
src/components/           QuestionCard, ProgressDots, StarRating, PillGroup,
                          ToggleChipGroup, TimeInput, DurationWheelPicker,
                          NoteInput, CheckInCard, StatCard, DotCalendar,
                          SleepTrendChart, SocialFrequency,
                          ScreenTimeTrendCard, ContextPeriodModal
src/components/finance/   finance-only components
src/pages/                Dashboard, Morning, Evening, Patterns, History,
                          ScreenTime, Settings, Finance
src/styles/               theme.css (palette tokens), global.css
supabase/                 idempotent SQL migrations
scripts/                  export-analysis-bundle.mjs — DB → Claude-chat bundle
analysis/                 CONTEXT / FINDINGS / ANALYZE docs shipped in each bundle
```

## Navigation

- `/` — dashboard: check-in cards, gym streak, dot calendar, sleep trend, social row, screen-time trend
- `/morning` — morning check-in (bedtime, wake, sleep quality, gym intention)
- `/evening` — evening check-in; accepts `?date=YYYY-MM-DD` to back-fill a missed day
- `/history` — read-only look-back over every day, incl. legacy deep-work data and confound badges
- `/screentime` — weekly batch entry of daily screen-time values
- `/patterns` — on-demand 30-day analysis from Claude, streamed in
- `/finance` — net worth, cash flow, transactions, review queue (see docs/FINANCE.md)
- `/settings` — reminder times, push subscription toggle, gym rest budget, location

## Icons

The manifest ships PNG icons from `public/`. `public/apple-touch-icon.png` is
the 180×180 iOS home-screen icon and doubles as the push-notification icon.

## Push notifications

Daily reminders are sent by a separate Cloudflare Worker in [worker/](worker/)
that runs on a 5-minute cron, checks current local time against
`push_settings.{morning,evening,weekly}_time`, and only fires if the matching
check-in fields for today are still empty. The weekly slot reminds you to log
last week's screen time — first on Sunday, then once a day until logged, and
never on Saturday. Notifications work on iPhone only after the user does
**Share → Add to Home Screen** (iOS 16.4+).

One-time setup:

```bash
# 1. Generate VAPID keypair
npx web-push generate-vapid-keys

# 2. SPA — put the public key in .env (and in Cloudflare Pages env vars)
echo "VITE_VAPID_PUBLIC_KEY=<public>" >> .env

# 3. Worker — install + push secrets
cd worker
npm install
npx wrangler secret put VAPID_PUBLIC_KEY      # paste public
npx wrangler secret put VAPID_PRIVATE_KEY     # paste private
npx wrangler secret put VAPID_SUBJECT         # mailto:you@example.com
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY          # the sb_secret_ key — bypasses RLS
npx wrangler deploy
```

`web-push` is only used here, as a one-shot CLI to generate the keypair — it is
never a dependency of this project (it's Node-only and won't run on Workers;
sending is hand-rolled in `worker/src/webpush.ts`).

To manually fire a notification (for testing):
`curl https://<worker-domain>/?force=morning` (also `evening`, `weekly`, `finance`).

## External data ingestion (Apple Health)

HRV, resting heart rate, step count, and sleep duration are **not** written
by the app. They come from an iOS Shortcut that POSTs directly to the
Supabase REST API. The app only needs the columns to exist (nullable).

```
POST {SUPABASE_URL}/rest/v1/entries
Headers:
  apikey: <anon key>
  Authorization: Bearer <anon key>
  Content-Type: application/json
  Prefer: resolution=merge-duplicates

Body:
  { "date": "YYYY-MM-DD", "hrv_avg": 45.2, "resting_hr": 58, "steps": 8432, "sleep_hours": 7.25 }
```

Notes:

- Use `Prefer: resolution=merge-duplicates` so the POST upserts into today's
  row alongside the morning/evening fields rather than failing on the primary
  key conflict.
- **Date keying:** `sleep_hours` is keyed to the morning the user woke up
  (same day as `sleep_quality`, `bedtime`, and `wake_time`) — i.e. when the
  Shortcut runs on morning D, `sleep_hours` is written to D, **not** D-1.
  The daily totals (`hrv_avg`, `resting_hr`, `steps`) are keyed to the day they
  were measured, which means they *are* backfilled to D-1 on the morning-D run.
- Omit fields you don't have a value for — never send `0` as a default.
  Missing data must stay null so the Patterns analyzer can correctly identify
  these as sparse signals.
- Weather (`weather_temp_f`, `weather_code`) is populated automatically by the
  cron Worker once per local day, using the lat/lon from `push_settings`.
  No external input needed.

## Analysis exports

`/patterns` is a quick 30-day read. For real analysis, export the whole dataset
and work through it in a Claude chat:

```bash
npm run export:analysis          # from the project root
```

That writes a dated bundle to `analysis-bundles/ember-YYYY-MM-DD/` (gitignored):

```
daily_merged.csv   one cleaned row per day + derived fields — the primary table
raw/*.csv          straight dumps: entries, screen_time, context_periods, …
MANIFEST.md        generated per run: date range, row counts, per-column coverage
CONTEXT.md         data dictionary, known quality problems, cleaning rules
FINDINGS.md        what's already been tested, and whether it held up
ANALYZE.md         the protocol, and the prompt to paste into the chat
```

Upload the folder's contents to a new chat and paste the prompt at the top of
[analysis/ANALYZE.md](analysis/ANALYZE.md). At the end of the run, paste the
updated findings block back into [analysis/FINDINGS.md](analysis/FINDINGS.md) —
that file is what makes this a running experiment rather than a series of
disconnected fishing expeditions, so it's worth the extra step.

Setup — put these in `.env.local` at the repo root (gitignored):

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=sb_secret_...    # secret key: bypasses RLS. Never ship it to the client.
```

The derived columns and cleaning rules in `daily_merged.csv` (sleep duration from
bedtime/wake, the >13h mislog cut, sub-1200 kcal days nulled, `day_index` for
detrending, next-day outcomes) are computed in
[scripts/export-analysis-bundle.mjs](scripts/export-analysis-bundle.mjs) and
documented in [analysis/CONTEXT.md](analysis/CONTEXT.md) — change one and you have
to change the other, or two runs stop being comparable.

The `finance_*` and `push_*` tables are deliberately excluded from the export.
Tables that don't exist are skipped with a warning, not an error.

## Notes

- The `entries` table is upserted on the primary key `date`. Morning fills the
  intent columns; evening fills the actuals — same row, never duplicated.
- The Anthropic model is hardcoded in [functions/api/claude.ts](functions/api/claude.ts)
  as `claude-sonnet-4-6`. To upgrade, change the `MODEL` constant there — the SPA
  never names a model.
- Service worker auto-updates silently on new builds via `registerSW({ immediate: true })`.
- There is no test suite by design (single user, low blast radius). A passing
  `npm run build` is the correctness signal — it typechecks all four sub-projects.
- Recharts is the largest dep; if bundle size becomes a concern, lazy-load the
  dashboard and finance charts behind `React.lazy()`.
