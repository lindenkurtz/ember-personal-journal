# Ember

A small, private daily journal for tracking sleep, focus, gym, and social time.
Single-user PWA. Lives behind Cloudflare Access. Built with React + Vite, Supabase,
and the Claude API.

## Stack

- **React + Vite** (TypeScript), deployed as a static site to Cloudflare Pages
- **Supabase** for persistence — one `entries` table, one row per day
- **Anthropic Claude** for the morning nudge and the patterns analysis, called
  through a Cloudflare Pages Function so the API key never ships to the browser
- **Plus Jakarta Sans** + warm palette

## Setup

```bash
npm install
cp .env.example .env       # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                # http://localhost:5173
```

The morning check-in works without the Anthropic key (it gracefully skips the
nudge); the patterns tab needs the Pages Function running. To test the function
locally:

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
  sleep_quality     smallint check (sleep_quality between 1 and 5),
  gym_intention     text check (gym_intention in ('yes','no','rest')),
  gym_actual        text check (gym_actual    in ('yes','no','rest')),
  deep_work_target  numeric(4,1),
  deep_work_actual  numeric(4,1),
  deep_work_start   time,
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
  id                 integer primary key default 1 check (id = 1),
  enabled            boolean not null default true,
  morning_time       text not null default '08:00',
  evening_time       text not null default '21:30',
  timezone           text not null default 'America/Denver',
  last_morning_sent  date,
  last_evening_sent  date,
  -- Used by the cron Worker to fetch weather from Open-Meteo:
  latitude           numeric(9,6),
  longitude          numeric(9,6),
  location_name      text,
  updated_at         timestamptz default now()
);

insert into public.push_settings (id) values (1) on conflict do nothing;
```

Since the app sits behind Cloudflare Access (single user), RLS isn't required.
If you ever expose it more broadly, add a policy keyed on `auth.uid()`.

## Deploy (Cloudflare Pages)

1. Connect this repo to Cloudflare Pages.
2. Build command: `npm run build`. Output: `dist`.
3. Environment variables:
   - `VITE_SUPABASE_URL` (Production + Preview) — build-time
   - `VITE_SUPABASE_ANON_KEY` (Production + Preview) — build-time
   - `ANTHROPIC_API_KEY` (Production + Preview) — runtime, available only to Functions
4. Add the Pages domain to Cloudflare Access (Zero Trust → Access → Applications).

## Project structure

```
functions/api/claude.ts   Pages Function — Anthropic proxy (key stays here)
src/lib/                  supabase, entries, claude, date, streaks helpers
src/components/           QuestionCard, ProgressDots, StarRating, PillGroup,
                          TimeInput, NumberStepper, NoteInput, StatCard,
                          DotCalendar, DeepWorkBarChart, SleepTrendChart,
                          SocialFrequency
src/pages/                Morning, Dashboard, Evening, Patterns
src/styles/               theme.css (palette tokens), global.css
```

## Navigation

- `/` — Morning check-in (skips straight to `/dashboard` if today is already started)
- `/dashboard` — streaks, dot calendar, weekly deep-work bars, sleep trend, social row
- `/evening` — reached from the dashboard; updates today's row in place
- `/patterns` — on-demand 30-day analysis from Claude, streamed in
- `/settings` — reminder times, push subscription toggle

## Icons

The manifest ships with the bundled SVG. For a polished iOS home-screen icon,
drop a 180×180 PNG at `public/apple-touch-icon.png` and uncomment the
`<link rel="apple-touch-icon">` in `index.html`.

## Push notifications

Daily reminders are sent by a separate Cloudflare Worker in [worker/](worker/)
that runs on a 5-minute cron, checks current local time against
`push_settings.{morning,evening}_time`, and only fires if the matching
check-in fields for today are still empty. Notifications work on iPhone only
after the user does **Share → Add to Home Screen** (iOS 16.4+).

One-time setup:

```bash
# 1. Generate VAPID keypair
npx web-push generate-vapid-keys

# 2. SPA — put the public key in .env so the subscribe flow can use it
echo "VITE_VAPID_PUBLIC_KEY=<public>" >> .env

# 3. Worker — install + push secrets
cd worker
npm install
npx wrangler secret put VAPID_PUBLIC_KEY      # paste public
npx wrangler secret put VAPID_PRIVATE_KEY     # paste private
npx wrangler secret put VAPID_SUBJECT         # mailto:you@example.com
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY          # anon is fine, no RLS
npx wrangler deploy
```

To manually fire a notification (for testing): `curl https://<worker-domain>/?force=morning`.

## External data ingestion (Apple Health)

HRV, resting heart rate, and step count are **not** written by the app. They
come from an iOS Shortcut that POSTs directly to the Supabase REST API. The
app only needs the columns to exist (nullable).

```
POST {SUPABASE_URL}/rest/v1/entries
Headers:
  apikey: <anon key>
  Authorization: Bearer <anon key>
  Content-Type: application/json
  Prefer: resolution=merge-duplicates

Body:
  { "date": "YYYY-MM-DD", "hrv_avg": 45.2, "resting_hr": 58, "steps": 8432 }
```

Notes:

- Use `Prefer: resolution=merge-duplicates` so the POST upserts into today's
  row alongside the morning/evening fields rather than failing on the primary
  key conflict.
- Omit fields you don't have a value for — never send `0` as a default.
  Missing data must stay null so the Patterns analyzer can correctly identify
  these as sparse signals.
- Weather (`weather_temp_f`, `weather_code`) is populated automatically by the
  cron Worker after each morning push, using the lat/lon from `push_settings`.
  No external input needed.

## Notes

- The `entries` table is upserted on the primary key `date`. Morning fills the
  intent columns; evening fills the actuals — same row, never duplicated.
- The Anthropic model is hardcoded in [functions/api/claude.ts](functions/api/claude.ts)
  as `claude-sonnet-4-20250514`. To upgrade, change the `MODEL` constant.
- Service worker auto-updates silently on new builds via `registerSW({ immediate: true })`.
- Recharts is the largest dep; if bundle size becomes a concern, lazy-load the
  dashboard charts behind `React.lazy()`.
