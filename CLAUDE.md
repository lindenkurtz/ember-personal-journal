# CLAUDE.md

Project guidance for Claude Code when working in this repo. Only conventions and
constraints that aren't obvious from reading the code. Setup instructions live in
[README.md](README.md); finance setup/operations in [docs/FINANCE.md](docs/FINANCE.md).

## What this is

**Ember** — a single-user PWA. Two features share one shell:

- **Daily journal** — sleep, gym, focused work, social, meal timing, confound
  flags, weekly-entered screen time. Morning and evening check-in flows, a
  dashboard, a history view, and a Claude-written patterns analysis.
- **Finance dashboard** at `/finance` — Plaid sync, Apple Card/Cash import by
  screenshot, transaction classification, net-worth snapshots.

React + Vite SPA, Supabase persistence, deployed as a static site to Cloudflare
Pages with Pages Functions in [functions/](functions/) and one separate
Cloudflare Worker in [worker/](worker/) (cron: push notifications, weather
snapshot, daily Plaid sync). Auth is delegated to Cloudflare Access — there is
no in-app login, and no user id anywhere in the schema.

Alongside the app, an **offline analysis workflow**: `npm run export:analysis`
dumps the whole database into a dated bundle that gets uploaded to a Claude chat.
It's not part of the deployed app — see the Architecture note below.

## This repo is public

**Nothing that identifies the user or describes their life may be committed.**
The deployment is private; the source is not. This is the one rule in this file
that can't be fixed after the fact — a push is public within minutes and is
archived by crawlers, so a later commit removing something does not un-publish
it. When in doubt, don't commit it; ask.

Never in a commit — no exceptions, including in a comment, a test fixture, an
example, or a commit message:

- **Health, mood, sleep, training, or nutrition data**, real or realistic —
  including summary statistics and correlations. The live `analysis/CONTEXT.md`
  and `analysis/FINDINGS.md` are gitignored for this reason; edit the tracked
  `*.template.md` files when the *structure* changes, never by pasting real data
  into them.
- **Names of the user's financial institutions** — bank, brokerage, loan
  servicer, card issuer. These are configuration, read from `finance_settings`
  (`brokerage_match`, `loan_servicer`, `cc_payment_payee`). A payment network
  the app has an actual code path for (Plaid, Venmo, Apple Card/Cash) is a
  feature, not a disclosure — those are fine.
- **Balances, amounts, transactions, account or card numbers.**
- **Identifying detail**: legal name beyond the existing git authorship, email,
  address, employer, school, coordinates, timezone as anything but a fallback
  default, or the shape of a daily routine.
- **Credentials and endpoints**: any key, token, VAPID private key, the Supabase
  project URL, the Worker's `*.workers.dev` hostname, or the Pages domain.

Two habits that keep this true:

- **New personal-data surface? Gitignore the real file and track a template.**
  That is the pattern `analysis/` uses, and the export tolerates a missing doc,
  so a clone still works.
- **New user-specific config? It's a DB column, not a constant.** The precedent
  is `finance_settings` — if a value would differ for another person, it belongs
  in a row, with a null default that turns the feature off cleanly.

Before any commit, sanity-check `git diff --staged` for the above. `npm run
build` will not catch any of it.

## Repo layout

```
src/                  SPA (React, DOM types)
  lib/                one module per Supabase table + date/streak/prompt helpers
  lib/finance/        SPA-side finance data access + screenshot extraction
  components/         journal UI primitives
  components/finance/ finance-only components
  pages/              one file + one sibling .css per route
  styles/             theme.css (tokens), global.css
  sw.ts               service worker — separate tsconfig, WebWorker types
functions/api/        Cloudflare Pages Functions (Workers types)
shared/finance/       runtime-agnostic finance logic — compiled into all three
worker/               separate cron Worker (Workers types)
supabase/             idempotent SQL migrations
analysis/             docs that ship inside every export bundle; the real
                      CONTEXT/FINDINGS are gitignored, templates are tracked
scripts/              plain Node ESM tooling — outside all four tsconfigs
docs/FINANCE.md       finance setup + operations
```

## Architecture

- **Four TypeScript projects, one solution.** DOM types, WebWorker types, and
  Workers types conflict if combined, so [tsconfig.json](tsconfig.json) is a
  solution-style references file and `tsc -b` builds all four:
  - [tsconfig.app.json](tsconfig.app.json) — SPA (`src/` + `shared/`), DOM types.
    Excludes `src/sw.ts` and the two server-only finance files.
  - [tsconfig.functions.json](tsconfig.functions.json) — Pages Functions
    (`functions/` + `shared/`), Workers types.
  - [tsconfig.sw.json](tsconfig.sw.json) — service worker only, `WebWorker` lib.
    Separate from the app config because DOM and WebWorker conflict on
    `self`/`addEventListener`.
  - [worker/tsconfig.json](worker/tsconfig.json) — cron Worker (`worker/src/` +
    `shared/`), Workers types.

  Put each new file under the directory whose tsconfig matches its runtime; don't
  reach across. All four set `noUnusedLocals`/`noUnusedParameters`, so an orphaned
  import or parameter fails the build.

- **Anthropic key never enters the browser.** All calls go through
  [functions/api/claude.ts](functions/api/claude.ts), which reads
  `ANTHROPIC_API_KEY` from the Pages env. Stream mode pipes Anthropic's SSE
  through unchanged — the client at [src/lib/claude.ts](src/lib/claude.ts) parses
  `content_block_delta` frames. Upstream errors come back as **HTTP 200 with a
  JSON error envelope** on purpose: Cloudflare's edge replaces 5xx bodies with
  its own branded page and would hide the real error. The model is the `MODEL`
  constant in the function; change it there, never in the SPA.

- **One Supabase lib module per table.** `entries` →
  [src/lib/entries.ts](src/lib/entries.ts); the singleton `push_settings` row →
  [src/lib/settings.ts](src/lib/settings.ts); `push_subscriptions` plus the
  browser subscribe flow → [src/lib/push.ts](src/lib/push.ts); `screen_time` →
  [src/lib/screenTime.ts](src/lib/screenTime.ts); `context_periods` →
  [src/lib/contextPeriods.ts](src/lib/contextPeriods.ts); the `finance_*` tables →
  one file each under [src/lib/finance/](src/lib/finance/). **Never call
  `supabase.from(...)` from a component.**

- **Routing** ([src/App.tsx](src/App.tsx)): `/` = Dashboard, plus `/morning`,
  `/evening`, `/patterns`, `/history`, `/screentime`, `/finance`, `/settings`.
  `/dashboard` and any unknown path redirect to `/`. Evening accepts
  `?date=YYYY-MM-DD` to back-fill a missed day.

- **Push is a three-piece system.** Client subscribe flow + permission gating in
  [src/lib/push.ts](src/lib/push.ts); the SW `push` / `notificationclick`
  handlers in [src/sw.ts](src/sw.ts); the sender is the **separate cron Worker**
  in [worker/](worker/) (not a Pages Function — those can't cron). The Worker
  runs every 5 minutes, computes local time in `push_settings.timezone` via
  `Intl.DateTimeFormat`, smart-skips when today's fields are already filled,
  dedupes per day via `last_{morning,evening,weekly}_sent`, and prunes
  `404`/`410` endpoints. Web Push (RFC 8291 aes128gcm + VAPID JWT) is hand-rolled
  with Web Crypto in [worker/src/webpush.ts](worker/src/webpush.ts) — **don't add
  the `web-push` npm package**, it's Node-only and won't run on Workers.

  Three slots: morning, evening, and `weekly` (screen-time reminder for the
  just-completed Sun–Sat week — fires on Sunday, then re-fires once a day as a
  differently-worded make-up nag while the week stays unlogged, but **never on
  Saturday**, the day the target week rolls over to the not-yet-loggable current
  week; mirrors `screenTimeWeekStart`).

  The Worker's `dueMorning`/`dueEvening` "done" rules must track
  `isMorningDone`/`isEveningDone` in
  [src/pages/Dashboard.tsx](src/pages/Dashboard.tsx) — if you change one, change
  the other. They are currently *not* identical: the Dashboard also requires
  `wake_time` and `gym_intention` for morning, so a partially-filled morning can
  show as pending on the dashboard while the Worker suppresses the reminder.
  Evening (`gym_actual` + `day_quality`) does match.

- **Finance: one sync, shared by two runtimes.** `runSync` in
  [shared/finance/sync.ts](shared/finance/sync.ts) is called by both the manual
  "Sync now" Pages Function
  ([functions/api/plaid/sync.ts](functions/api/plaid/sync.ts)) and the daily cron
  Worker (`financeTick` in [worker/src/index.ts](worker/src/index.ts)), so they
  can't drift. `shared/finance/` is pure and runtime-agnostic; the two
  server-only files (`sync.ts`, `plaidApi.ts`) are explicitly **excluded** from
  [tsconfig.app.json](tsconfig.app.json) so Plaid logic never enters the SPA
  bundle. Plaid is raw REST in
  [shared/finance/plaidApi.ts](shared/finance/plaidApi.ts) — **don't add the
  `plaid` npm SDK**, it's axios/Node-only (same rule as `web-push`).
  `finance_plaid_items` holds access tokens and has **no anon RLS policy** — it
  is server-only; never read it from the SPA. Everything else finance lives in
  [docs/FINANCE.md](docs/FINANCE.md).

- **Two analyses, deliberately different.** `/patterns` is the shallow one: 30
  days from [src/lib/promptData.ts](src/lib/promptData.ts), streamed through
  `/api/claude`, no memory between runs. The **analysis bundle** is the deep one —
  `npm run export:analysis` (from the project root) runs
  [scripts/export-analysis-bundle.mjs](scripts/export-analysis-bundle.mjs) on
  Node, pulls every table with the Supabase **secret** key, writes raw dumps plus
  a cleaned merged daily table to `analysis-bundles/ember-YYYY-MM-DD/`
  (gitignored), and copies `analysis/CONTEXT.md`, `analysis/FINDINGS.md` and
  [analysis/ANALYZE.md](analysis/ANALYZE.md) in beside a freshly generated
  `MANIFEST.md`. The first two are **gitignored** — they hold real health data —
  and the tracked
  [analysis/CONTEXT.template.md](analysis/CONTEXT.template.md) /
  [analysis/FINDINGS.template.md](analysis/FINDINGS.template.md) carry their
  structure instead. A missing doc is a warning, not an error, so a fresh clone
  still exports. Edit a template only to change the *shape*; never paste real
  data in. The folder is zipped alongside itself and the zip is uploaded to
  a Claude chat by hand; it never goes through `/api/claude`, and nothing about it
  ships in the app.

  Supabase is not its only source. `mac_minutes` in `daily_merged.csv` comes from
  **focusd** (`~/Code/Personal/timetracking/focusd`), a local macOS daemon, by shelling
  out to `focusctl report --by day` at export time. Nothing is synced or stored —
  focusd's own rule is that durations are derived at query time, so the export asks
  it fresh every run. If `focusctl` isn't on PATH the column is null and the rest
  of the export is unaffected.

  Four things to keep true:
  - **`buildDaily`'s cleaning rules and the "Derived fields" / "Cleaning rules"
    sections of CONTEXT.md *and* its template are one spec written three times.**
    Change one, change the others — otherwise successive runs quietly stop being comparable, which is
    the failure mode this whole workflow exists to prevent.
  - **`FINDINGS.md` is state, not a report.** Each run appends to the
    confirmatory register; exploratory hits get *promoted* into that register to
    be retested on future data, never written up as discoveries. Don't rewrite
    past run lines — their value is that the hypothesis was fixed before the data
    existed.
  - **`mac_minutes` distinguishes 0 from null, and that distinction is the whole
    point.** A day focusd observed but credited no attended time to is a real `0`;
    a day it observed nothing at all is `null`, because focusd can't tell a shut
    laptop from a dead daemon and inventing the zero would manufacture an
    observation. The first observed day and the export day are null as partial by
    construction. Don't "fix" the nulls by filling them.
  - **`finance_*` and `push_*` are excluded from `TABLES` on purpose.** The list
    also names tables with no migration in [supabase/](supabase/)
    (`daily_nutrition`, `body_weight`, `lift_progression`); `fetchAll` skips a
    table that isn't there with a warning instead of failing, so a partial
    database still exports.

## Data conventions

- **Date keys** are ISO `YYYY-MM-DD` in the user's local timezone. Always go
  through [src/lib/date.ts](src/lib/date.ts) (`todayKey`, `dayKey`, `lastNDays`,
  `addDaysKey`, …) — never `new Date().toISOString().slice(0, 10)`, which is UTC
  and will flip days for the user. The Worker can't import `src/lib/date.ts`
  (different runtime, no date-fns) and has its own `addDaysKey` doing UTC math on
  bare key strings; keep it that way.

- **Row-date semantics differ for sleep vs daily totals.** A row's date D is *the
  day the user woke up* for the sleep fields (`bedtime`, `wake_time`,
  `sleep_quality`, and `slept_away`) — all describe the night ending on morning D.
  `bedtime`/`wake_time` are the user-entered window. For daily totals (`hrv_avg`,
  `resting_hr`, `steps`), D is the calendar day the metric was measured, which is
  why the iOS Shortcut backfills those to D-1 when it runs the next morning.
  Re-keying a sleep field to the night's *start* date would silently desync it
  from `sleep_quality`.

- **`sleep_hours` is retired (Sept 2026); its 4 rows are permanent.** It was meant
  to be the Apple Watch's measured duration of the `bedtime`/`wake_time` window,
  written by the iOS Shortcut, but the Shortcut never reliably sent it — the column
  holds 4 days from May 2026 and nothing since. The column and those rows stay in
  the DB, and nothing reads, renders, writes, or exports it (same rule as the
  `deep_work_*` columns and `computer_minutes`). **There is now no objective sleep
  measurement anywhere in the dataset** — self-reported `bedtime`/`wake_time` are
  the only duration evidence, so don't describe any sleep number as objective or
  watch-measured. If a reliable source ever appears, it lands as a new field with
  its own `*_START` constant, not by reviving this one.

- **Nullable means untracked, not "no."** The six confound flags (`sick`,
  `alcohol`, `slept_away`, `travel_day`, `caffeine_late`, `deadline_pressure`)
  have no DB default. The evening flow writes explicit true/false, but only for
  dates `>= TRACKING_V2_START` ([src/lib/entries.ts](src/lib/entries.ts)). That
  gate exists because `/evening?date=` is an open URL: without it, re-editing a
  pre-migration day would stamp `false` onto rows from before the flags were
  tracked, destroying the tracked-vs-untracked distinction the analysis depends
  on. `focused_work` has the same shape of gate at `FOCUSED_WORK_START`. **Any
  new write path must keep this rule**, and any new gated field needs its own
  `*_START` constant.

- **Deep work is retired (July 2026); its data is permanent.** The `deep_work_*`
  columns on `entries` and `deep_work_rest_budget*` on `push_settings` still hold
  all May–June data — never drop, rewrite, or repurpose them, and no UI may write
  them again. [src/pages/History.tsx](src/pages/History.tsx) renders the legacy
  values and the prompts keep `dw_p`/`dw_a` on historical rows with a retirement
  note in the legend; everything else deliberately doesn't select them.
  `focused_work` (`none|light|solid|deep`) is the replacement — its definition
  text must stay *persistent* helper text on the evening step, not a tooltip, so
  scoring stays consistent across months.

- **Gym streak uses a weekly rest budget, resolved per-week from history.**
  `gymStreak(entries, currentBudget, history?)` in
  [src/lib/streaks.ts](src/lib/streaks.ts) groups `'no'` days by Mon–Sun week
  (`weekStartKey`); once a week's `'no'` count exceeds *that week's* budget, every
  `'no'` in the week breaks the streak. `budgetForWeek` resolves the applicable
  budget from `push_settings.rest_budget_history` (ascending `{ from, budget }`
  entries), falling back to `currentBudget` only when history is empty. Budget
  changes must go through `setRestBudget` in
  [src/lib/settings.ts](src/lib/settings.ts) — it appends/replaces the current
  week's entry and seeds a `2000-01-01` sentinel on first change so earlier weeks
  stay pinned to the original budget. Don't reduce this to a single-number
  signature: the whole point is that changing the budget mid-streak never
  retroactively breaks past weeks. `GymChoice` is `'yes' | 'no'` — there is no
  `'rest'` value (the DB check constraint still allows it for legacy rows); rest
  is the budget's job. Any page showing the streak must load settings alongside
  entries.

- **Screen time is a separate weekly-entered table.** Daily granularity in
  `screen_time`, entered in batches at `/screentime` for the most recently
  completed Sunday–Saturday week (`screenTimeWeekStart`) — matching iOS Screen
  Time's own weekly reset, so on a Sunday entry night every day shown is already
  done. All-blank days are never written; sparse weeks must stay sparse. "Week
  logged" everywhere (Dashboard nag card, Worker smart-skip) means **≥1 row
  exists for that Sun–Sat week**, so intentionally partial weeks never nag
  forever. Phone and iPad minutes are deliberately separate columns — merging
  them would fake a downward trend when scrolling moves between devices.
  `computer_minutes` (Mac + iPad combined) was **retired Aug 2026** when Mac time
  moved to a separate system: the column and its rows stay in the DB, but nothing
  selects, writes, or exports it, and it was never backfilled into `ipad_minutes`
  — the two measure different devices. Same rule as the `deep_work_*` columns.
  That separate system is **focusd**, and it stays separate — Mac time is measured
  automatically, never entered at `/screentime`, and reaches only the analysis
  bundle (as `mac_minutes`), never Supabase, the Dashboard, or `/patterns`. Don't
  add a `mac_minutes` column to `screen_time`.

- **`context_periods` overlap is impossible at the DB level** — a gist EXCLUDE
  constraint over `daterange(start_date, end_date, '[]')` with *inclusive*
  bounds, so adjacent periods must not share a day (a new period starts the day
  after the previous `end_date`; the editor defaults handle this). `end_date`
  null = currently active. Resolution is client-side via `periodForDate`. The
  Dashboard shows a per-day-dismissible banner when today falls in no period;
  dismissals live in `localStorage` (`ember:ctxDismissed`), never the DB.

- **Finance amounts: inflow positive, outflow negative.** Plaid's convention is
  the opposite — invert on ingest. **Savings rates** read off a per-transaction
  `savings_bucket` (`short_term`/`long_term`/`retirement`) — the single source of
  truth, so a transfer is counted exactly once regardless of which side is
  connected.

## Code conventions

- **Styling: hand-rolled CSS, no framework.** Each component and page has a
  sibling `.css` file. Class names are BEM-ish and component-prefixed
  (`.stars__btn`, `.qcard__question`). Theme tokens live in
  [src/styles/theme.css](src/styles/theme.css) — **never hardcode a color**; use
  `var(--amber)`, `var(--card)`, etc. Adding a new color means adding a token,
  not a one-off hex.

- **Journal-flow primitive.** Morning and Evening share one pattern: a `Step`
  union, a `draft` object, a `QuestionCard` per step with framer-motion fade,
  `ProgressDots` up top, `morning__primary` / `morning__ghost` buttons at the
  bottom, and an `isValid(step, draft)` gate on Next. Evening imports
  `Morning.css` for the shared layout classes. If you build a third flow, factor
  out a `CheckInFlow` controller — don't fork the layout a third time.

- **One useEffect, prefill draft, degrade gracefully.** Pages that read existing
  rows (Morning, Evening, Dashboard, Settings, Finance) seed state from Supabase
  but never throw — if the network or config is broken, the UI still works for
  fresh input. Follow the `Promise.all` + `setState` + cancel-flag pattern in
  [src/pages/Morning.tsx](src/pages/Morning.tsx). Where the distinction matters,
  `null` state means "fetch failed" and hides the feature, rather than falsely
  claiming nothing is logged (see `periods` / `screenWeek` in Dashboard).

- **Patterns has exactly one target.** `day_quality` (1–5, captured in the
  evening) is what Claude looks for predictors of. A new tracked field is always
  a *predictor* — never promote it to a second target. Where a subjective and an
  objective measure of the same thing both exist, frame them as such in the prompts
  so Claude can surface discrepancies; both are signal, neither is ground truth.
  Right now the only such pair is self-rated `focused_work` against `mac_minutes`
  in the analysis bundle — sleep has no objective half since `sleep_hours` retired.
  Confound flags are framed as *confounders* (explain outliers, discount
  distorted days), never as goals.

- **No comments restating what the code does.** Comments explain *why* — a
  non-obvious constraint, a deliberate skip, a workaround. Match the tone of the
  existing files.

## How to make changes

Every recipe ends the same way: run `npm run build` from the repo root.

### Add a tracked field to `entries`

1. Add the column in a new idempotent `supabase/*.sql` migration
   (`alter table ... add column if not exists`). **Nullable, no default** — a
   default destroys the untracked-vs-false distinction.
2. Add it to the `Entry` interface in [src/lib/entries.ts](src/lib/entries.ts).
   `getEntry`/`getRange` select `*`, so nothing else changes there.
3. If it's asked from a start date, add a `*_START` constant next to
   `TRACKING_V2_START` and gate **both** the step list and the save payload on
   `targetDate >= START`.
4. Add the question step to Morning or Evening (recipe below).
5. Add it to **both** the row builder and `FIELD_LEGEND` in
   [src/lib/promptData.ts](src/lib/promptData.ts) — one edit covers the Patterns
   analysis and the morning nudge, which is exactly why they share the module.
   Use a short key; the legend must state units and the null semantics.
6. Add it to `buildDaily` in
   [scripts/export-analysis-bundle.mjs](scripts/export-analysis-bundle.mjs) and
   document it in [analysis/CONTEXT.md](analysis/CONTEXT.md) — including its
   start date in the "Schema changes" table, since coverage on a new field is low
   by design and an undocumented one reads as a logging failure.
7. Optionally surface it on History / Dashboard.

### Add a question step to a check-in flow

In [src/pages/Morning.tsx](src/pages/Morning.tsx) or
[src/pages/Evening.tsx](src/pages/Evening.tsx): extend the `Step` union and the
questions list, add the field to the `Draft*` interface and its initial state,
seed it in the prefill `useEffect`, render a `QuestionCard` branch in `StepView`
using an existing input primitive, add a `case` to `isValid` (return `true` if
optional), and include it in the `submit()` patch. `ProgressDots` reads the
questions array length, so it updates itself.

### Add a page / route

Create `src/pages/Name.tsx` + `Name.css`, register it in
[src/App.tsx](src/App.tsx) above the catch-all redirect, and link to it from the
Dashboard header. Follow the prefill-and-degrade `useEffect` pattern.

### Add a Supabase table the SPA writes

1. Idempotent migration: `create table if not exists`, `enable row level
   security`, and **three permissive `anon` policies — SELECT, INSERT, UPDATE**
   (plus DELETE if the SPA deletes). See the RLS gotcha below for why SELECT is
   non-negotiable.
2. New `src/lib/<table>.ts` exporting an interface, a `COLUMNS` string, and
   read/write functions. No component touches `supabase.from` directly.
3. If the cron Worker needs it, it reads with the secret key and bypasses RLS —
   nothing extra to configure.

### Add a component

`src/components/Name.tsx` + `Name.css`, default export, `ariaLabel` prop if it's
an input, tokens from `theme.css` for every color. Finance-only components go in
`src/components/finance/`.

### Change what Claude sees or says

- Model, `max_tokens` default, vision handling: `MODEL` and the request body in
  [functions/api/claude.ts](functions/api/claude.ts).
- Shared data and legend for both prompts:
  [src/lib/promptData.ts](src/lib/promptData.ts).
- Prompt wording: `buildNudgePrompt` in Morning, `buildPrompt` in
  [src/pages/Patterns.tsx](src/pages/Patterns.tsx), the extraction prompt in
  [src/lib/finance/extract.ts](src/lib/finance/extract.ts).
- Requires `npm run pages:dev` to exercise — `npm run dev` has no `/api/*`.

### Change notification behavior

Edit [worker/src/index.ts](worker/src/index.ts) (`dueMorning`, `dueEvening`,
`dueWeekly`, `payloadFor`), then `cd worker && npm run tick` to fire the
scheduled handler immediately, or hit
`/?force=morning|evening|weekly|finance&key=<FORCE_KEY>` on the deployed Worker.
That endpoint is gated on the `FORCE_KEY` secret and **fails closed** — the
Worker is on `*.workers.dev`, which Cloudflare Access doesn't cover, so an
unset or wrong key returns an indistinguishable 404. Don't loosen it, and don't
echo caught errors into the response body. If you touch a "done" rule, check the matching
`isMorningDone`/`isEveningDone` in Dashboard. New settings columns need adding to
both the Worker's `Settings` interface + its select list and the SPA's
`PushSettings` + `COLUMNS` in [src/lib/settings.ts](src/lib/settings.ts).

### Add a finance category or classification rule

Categories are a closed union in
[shared/finance/types.ts](shared/finance/types.ts) plus `CATEGORIES` /
`CATEGORY_LABELS` in [shared/finance/categories.ts](shared/finance/categories.ts)
and the Plaid mapping tables there. Classification logic is
[shared/finance/classify.ts](shared/finance/classify.ts), data-driven off
`finance_settings` — `cc_payment_payee`, plus `brokerage_match` (comma-separated
substrings identifying the user's brokerage, threaded in through
`ClassifyContext.brokerageMatch`) and `loan_servicer`. **No institution name
belongs in this repo**: a new one is a `finance_settings` column with a null
default that turns its branch off, never a string literal. `loan_servicer` is
additionally the upsert key for `finance_loan_balances` and the net-worth rollup
sums the latest balance per distinct servicer — so it must stay byte-stable, or
old rows are stranded under the old name and counted on top of the new ones. A re-sync **never clobbers a transaction the
user has `reviewed`** (the preserve branch in `upsertTransactions`), and account
`include_in_net_worth` toggles are likewise preserved — keep both invariants.
User-authored rules live in `finance_rules` and are created from the transaction
editor, not in code.

### Change what the analysis bundle exports or how it's analyzed

- New table in the dump: add it to `TABLES` in
  [scripts/export-analysis-bundle.mjs](scripts/export-analysis-bundle.mjs), and
  merge it into `buildDaily` if it's daily-keyed.
- New derived column or changed cleaning rule: edit `buildDaily` **and** the
  matching bullet in [analysis/CONTEXT.md](analysis/CONTEXT.md) in the same
  commit.
- Changing the Mac number: it comes from `focusctl`, not the database — see
  `fetchMacMinutes` in the export script. `--attended` is the deliberate choice
  (unfiltered counts a machine left awake, which is what killed `computer_minutes`);
  the parser reads `focusctl report`'s text output, so it's worth re-running the
  export after a focusd upgrade. A format change makes it warn and null the column,
  not fail.
- New known data-quality problem: CONTEXT.md, "Known data-quality problems".
  These are the guardrails that stop a run from reporting an artifact as a
  finding — worth writing down the moment you notice one.
- Protocol, output format, or the prompt to paste into the chat:
  [analysis/ANALYZE.md](analysis/ANALYZE.md).
- Results of a run: paste the model's findings block into
  [analysis/FINDINGS.md](analysis/FINDINGS.md) (append, don't rewrite).

`npm run build` doesn't cover any of this — `scripts/` is outside every tsconfig.
Verify with an actual `npm run export:analysis` run.

### Add an env var or secret

Decide the runtime first. `VITE_*` → `.env` **and** Cloudflare Pages env vars
(build-time, ends up in the bundle — never a secret). Pages Function server var →
`.dev.vars` locally, Pages dashboard in production. Cron Worker → `npx wrangler
secret put NAME` from `worker/`, and add it to the `Env` interface in
`worker/src/index.ts`. Document it in [README.md](README.md) or
[docs/FINANCE.md](docs/FINANCE.md) and add a placeholder to `.env.example` if
it's a `VITE_*`.

## Workflow

```bash
npm run dev              # SPA only — /api/* 404s
npm run build            # tsc -b && vite build → dist/
npm run pages:dev        # wrangler pages dev dist — needed for /api/claude and /api/plaid

cd worker && npm run dev     # wrangler dev — local cron Worker
cd worker && npm run tick    # wrangler dev --test-scheduled — fires the scheduled handler now
cd worker && npm run deploy  # wrangler deploy

npm run export:analysis  # root only — dumps the DB to analysis-bundles/ember-<date>/
```

Local env: `.env` for `VITE_*` (see `.env.example`), `.dev.vars` for server-side
Function vars (`ANTHROPIC_API_KEY`, `PLAID_*`, `SUPABASE_SERVICE_KEY`), and
`.env.local` for the export script (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — the
`sb_secret_` key, since the export bypasses RLS). All three are gitignored, as is
the `analysis-bundles/` output.

**After any change, run `npm run build` from the repo root.** `tsc -b`
typechecks all four sub-projects via the references in
[tsconfig.json](tsconfig.json), then Vite + PWA produces the output. A passing
build is the correctness signal — there is no test suite by design (single user,
low blast radius). Worker-only changes are covered too: the root solution
references `worker/`, so run the root build for those as well.

## Gotchas

- **The `VITE_` prefix matters.** `VITE_*` vars are bundled into the client;
  everything else is server-side only. Don't move the Anthropic key, a Plaid
  secret, or the Supabase secret key into a `VITE_*` var "for convenience."
- **Two Supabase keys, two roles, RLS is on everywhere.** The SPA uses a
  **publishable** key (`sb_publishable_…`, in `VITE_SUPABASE_ANON_KEY`) that
  authenticates as `anon` and is subject to policy. The cron Worker and the Plaid
  Functions use a **secret** key (`sb_secret_…`) that bypasses RLS — necessary
  because they have no user session and would otherwise read zero rows. The
  secret key lives only in Wrangler secrets and the Pages dashboard. If you
  rotate, stay on the `sb_publishable_`/`sb_secret_` system; the legacy
  `anon`/`service_role` JWTs share a signing secret and can't be rotated
  independently.
- **Every SPA-writable table needs `anon` SELECT *and* INSERT *and* UPDATE — not
  just the verbs you think you're using.** `supabase-js` chains `.select()` after
  `upsert()` throughout this codebase, which sends `Prefer: return=representation`
  and triggers a SELECT-after-write. With RLS on, that post-write SELECT is
  evaluated against `anon`'s SELECT policy; with only INSERT/UPDATE policies the
  write passes but the read-back fails with `401 / PostgREST 42501` — the same
  error shape as a denied write, which makes it easy to misdiagnose. Supabase
  dashboard policy templates default to the `authenticated` role, which won't
  help you: the publishable key is `anon`.
- **Service worker is hand-written** at [src/sw.ts](src/sw.ts) (`injectManifest`).
  Workbox precaching and runtime caching rules live *in that file*, **not in
  [vite.config.ts](vite.config.ts)**. `/api/*` is `NetworkOnly` there on purpose;
  don't cache Anthropic or Plaid responses.
- **`skipWaiting()` + `clientsClaim()` in the SW are load-bearing.** iOS
  backgrounds the home-screen PWA instead of closing it, so without them a new
  deploy's SW sits "waiting" forever and the app is stuck on a stale bundle.
  Combined with `registerType: 'autoUpdate'` and `registerSW({ immediate: true })`
  in [src/main.tsx](src/main.tsx), the next navigation after a deploy refreshes —
  don't add an in-app update prompt.
- **iOS push only works inside the home-screen-installed PWA**, not Safari tabs.
  `pushSupport()` in [src/lib/push.ts](src/lib/push.ts) gates the Settings toggle
  on `display-mode: standalone` || `navigator.standalone` for exactly this
  reason. Don't remove that check. `subscribe()` rolls back the browser
  subscription if the DB write fails, so the toggle never lies.
- **`VITE_VAPID_PUBLIC_KEY` must be set in the Cloudflare Pages env vars**, not
  just `.env` — `.env` is local-only. The build succeeds without it; the Settings
  toggle just stays disabled with a banner.
- **Cron runs every 5 minutes, not at the configured times.** The Worker checks
  the user's local time inside the handler via `Intl.DateTimeFormat`. This is
  deliberate so DST flips need no code change; don't switch to per-time cron
  expressions or you'll create a twice-yearly maintenance burden.
- **The weather snapshot is independent of push.** It runs once per local day
  whenever coords are set, even if no subscription exists or the morning push was
  smart-skipped. Don't fold it back into the send path.
- **Apple Card's account id is `csv-apple-card` and its `source` is `'csv'`**
  even though CSV import no longer exists (screenshots replaced it). Those are
  frozen strings keeping existing rows joined — don't rename them.
- **Run the export through `npm run export:analysis`, not `node
  scripts/export-analysis-bundle.mjs`.** The `--env-file=.env.local` flag lives in
  the npm script, so invoking the file directly exits on "Missing SUPABASE_URL"
  even with a perfectly good `.env.local` sitting there.
- **`scripts/` and `analysis/` are outside the four-project solution.** The export
  script is `.mjs` on purpose — `tsc -b` never sees it, so a broken one still
  passes `npm run build`. Its `SUPABASE_SERVICE_KEY` is the same secret key the
  Plaid Functions use, just read from `.env.local` instead of `.dev.vars`; it
  bypasses RLS, so keep it out of anything `VITE_*` and out of the bundle
  directory you upload.
- Recharts dominates the bundle (~290kB gzipped total). Don't add another
  charting library; reuse or extend the existing chart components.
