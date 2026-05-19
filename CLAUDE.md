# CLAUDE.md

Project guidance for Claude Code when working in this repo. Keep it tight — only conventions that aren't obvious from reading the code.

## What this is

**Ember** — a single-user PWA journal for daily sleep / gym / deep work / social tracking. React + Vite SPA, Supabase persistence, deployed as a static site to Cloudflare Pages with one Pages Function (Anthropic proxy in [functions/](functions/)) and one separate Cloudflare Worker (cron-scheduled push-notification dispatcher in [worker/](worker/)). Auth is delegated to Cloudflare Access — there is no in-app login.

## Architecture (the parts worth knowing)

- **Five TypeScript projects, one solution.** DOM types, WebWorker types, and Workers types all conflict if combined, so [tsconfig.json](tsconfig.json) is a solution-style references file and `tsc -b` builds the lot:
  - [tsconfig.app.json](tsconfig.app.json) — SPA (`src/`), DOM types. Explicitly excludes `src/sw.ts`.
  - [tsconfig.functions.json](tsconfig.functions.json) — Pages Function (`functions/`), Workers types.
  - [tsconfig.sw.json](tsconfig.sw.json) — service worker (`src/sw.ts`), `WebWorker` lib. Separated from the app config because DOM and WebWorker conflict on `self`/`addEventListener`.
  - [worker/tsconfig.json](worker/tsconfig.json) — cron Worker, Workers types.
  - When you add a file, drop it under the directory whose tsconfig matches the runtime; don't reach across.

- **Anthropic key never enters the browser.** All calls go through [functions/api/claude.ts](functions/api/claude.ts), which reads `ANTHROPIC_API_KEY` from the Pages env. Stream mode pipes Anthropic's SSE through unchanged — the client at [src/lib/claude.ts](src/lib/claude.ts) parses `content_block_delta` frames. The model is hardcoded as `MODEL` in the function; change it there, not in the SPA.

- **One Supabase lib module per table.** [src/lib/entries.ts](src/lib/entries.ts) owns `entries`; [src/lib/settings.ts](src/lib/settings.ts) owns the singleton `push_settings` row; [src/lib/push.ts](src/lib/push.ts) owns `push_subscriptions` plus the browser subscribe flow. Never call `supabase.from(...)` directly from a component. The `entries` schema is one row per `date`; morning and evening both `upsert` on the primary key, never insert duplicates.

- **Routing:** `/` = Dashboard, `/morning`, `/evening`, `/patterns`, `/settings`. `/dashboard` redirects to `/` for legacy links. Evening accepts `?date=YYYY-MM-DD` to back-fill a missed previous day.

- **Push notifications are a two-piece system.** Client subscribe flow + permission gating live in [src/lib/push.ts](src/lib/push.ts); the SW `push` / `notificationclick` handlers in [src/sw.ts](src/sw.ts). VAPID public key is bundled as `VITE_VAPID_PUBLIC_KEY`. The server-side sender is a **separate Cloudflare Worker** in [worker/](worker/) (not a Pages Function — Pages Functions can't cron). It runs every 5 minutes, computes current time in `push_settings.timezone` via `Intl.DateTimeFormat`, smart-skips when today's check-in fields are already filled, dedupes via `last_morning_sent` / `last_evening_sent`, and prunes `410 Gone` endpoints. Web Push (RFC 8291 aes128gcm + VAPID JWT) is hand-rolled with Web Crypto in [worker/src/webpush.ts](worker/src/webpush.ts) — **don't add the `web-push` npm package**, it's Node-only and won't run on Workers.

## Conventions

- **Styling: hand-rolled CSS, no framework.** Each component has a sibling `.css` file (e.g. `StarRating.tsx` + `StarRating.css`). Class names are BEM-ish and component-prefixed (`.stars__btn`, `.qcard__question`). Theme tokens live in [src/styles/theme.css](src/styles/theme.css) — **never hardcode a color**; use `var(--amber)`, `var(--card)`, etc. Adding a new color? Add a token, not a one-off hex.

- **Journal-flow primitive.** Morning and Evening both use the same pattern: a `QuestionCard` with framer-motion fade between steps, `ProgressDots` up top, and the `morning__primary` / `morning__ghost` buttons at the bottom. Evening imports `Morning.css` for shared layout classes. If you build a third flow, factor out a `CheckInFlow` controller — don't fork the layout a third time.

- **Date keys** are ISO `YYYY-MM-DD` strings in the user's local timezone. Always go through [src/lib/date.ts](src/lib/date.ts) (`todayKey`, `dayKey`, `lastNDays`) — never `new Date().toISOString().slice(0, 10)` (that's UTC and will flip days for the user).

- **Row-date semantics differ for sleep vs daily totals.** A row's date D means *the day the user woke up* for sleep fields (`bedtime`, `sleep_quality`, `sleep_hours`) — all three describe the night ending on morning D. For daily totals (`hrv_avg`, `resting_hr`, `steps`), D is the calendar day the metric was measured, which is why the iOS Shortcut backfills those to D-1 when it runs the next morning. Don't accidentally re-key `sleep_hours` to the night's *start* date — it would silently desync from `sleep_quality` and break the subjective-vs-objective comparison in the Patterns prompt.

- **One useEffect, prefill draft, ignore errors gracefully.** Pages that read existing rows (Morning, Evening, Dashboard, Settings) seed their state from Supabase but never throw — if the network or config is broken, the UI still works for fresh input. Follow the `Promise.all + setState + cancel-flag` pattern in [src/pages/Morning.tsx](src/pages/Morning.tsx) or [src/pages/Settings.tsx](src/pages/Settings.tsx) when adding new pages.

- **Patterns has one primary target.** `day_quality` (1–5, captured in the evening via the same `StarRating` as `sleep_quality`) is flagged in [src/pages/Patterns.tsx](src/pages/Patterns.tsx) as the variable Claude should find predictors of. When you add a new tracked field to `entries`, include it as a *predictor* in the Patterns and Morning nudge prompts — don't promote it to a second target. One target keeps the analysis focused. Subjective/objective pairs (e.g. `sleep_quality` 1–5 vs `sleep_hours` from Apple Watch) should be explicitly framed as such in the prompts so Claude can surface discrepancies — both are signal, neither is ground truth.

- **Gym streak uses a weekly rest budget, resolved per-week from history.** `gymStreak(entries, currentBudget, history?)` in [src/lib/streaks.ts](src/lib/streaks.ts) groups `'no'` days by Mon–Sun calendar week (via `weekStartKey` in [src/lib/date.ts](src/lib/date.ts)); once a week's `'no'` count exceeds *that week's* budget, every `'no'` in that week breaks the streak. The applicable budget for each week is resolved by `budgetForWeek` from `push_settings.rest_budget_history` (an ascending list of `{ from, budget }` entries), falling back to `currentBudget` only when history is empty. Mutating the budget must go through `setRestBudget` in [src/lib/settings.ts](src/lib/settings.ts) — it appends/replaces the entry for the current week and seeds a `2000-01-01` sentinel on first change so weeks before any change stay pinned to the original budget. Don't reduce this back to a single-number signature: the whole point is that changing the budget mid-streak never retroactively breaks past weeks. `GymChoice` is `'yes' | 'no'` — there is no `'rest'` value; that's the budget's job. Any page that displays the streak must load settings alongside entries so the budget and history are available (see [src/pages/Dashboard.tsx](src/pages/Dashboard.tsx)).

- **No comments restating what the code does.** Comments only explain *why* — a non-obvious constraint, a deliberate skip, a workaround. See the existing files for tone.

## Workflow

```bash
npm run dev              # SPA only, no /api/claude
npm run build            # tsc -b && vite build, outputs to dist/
npm run pages:dev        # wrangler pages dev dist — needed to exercise the Anthropic proxy

cd worker && npm run dev     # wrangler dev — local cron Worker
cd worker && npm run tick    # wrangler dev --test-scheduled — fires the scheduled handler immediately
cd worker && npm run deploy  # wrangler deploy
```

For the function locally, drop `ANTHROPIC_API_KEY=...` into `.dev.vars` (gitignored). For Supabase, `.env` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_VAPID_PUBLIC_KEY`.

After changes, **always run `npm run build`** from the project root — `tsc -b` typechecks all four sub-projects (SPA, Pages Function, service worker, cron Worker) via the references in [tsconfig.json](tsconfig.json), then Vite + PWA produces the output. A passing build is the signal of correctness; there is no test suite by design (single-user, low blast radius).

## Gotchas

- The `VITE_` prefix matters. `VITE_*` env vars are bundled into the client; everything else is server-side only. Don't move the Anthropic key into a `VITE_*` var "for convenience."
- **Service worker is hand-written** at [src/sw.ts](src/sw.ts) (`injectManifest` strategy). Workbox precaching + runtime caching rules live in that file now — **not in [vite.config.ts](vite.config.ts)**. If you add a new cached route, edit `src/sw.ts`. `/api/*` is `NetworkOnly` there for a reason; don't cache Anthropic responses.
- The SW still uses `registerType: 'autoUpdate'` with `registerSW({ immediate: true })` (in [src/main.tsx](src/main.tsx)). On any deploy, the next navigation refreshes — no in-app prompt. Don't add one.
- **iOS push only works inside the home-screen-installed PWA**, not Safari tabs. `pushSupport()` in [src/lib/push.ts](src/lib/push.ts) gates the Settings toggle on `display-mode: standalone` || `navigator.standalone` for exactly this reason. Don't remove that check.
- **`VITE_VAPID_PUBLIC_KEY` must be set in Cloudflare Pages env vars**, not just `.env` — `.env` is local-only. Build succeeds without it; the Settings toggle just stays disabled with a banner. Same `VITE_*` build-time pattern as the Supabase vars.
- **Worker secrets live in Wrangler, not `.env`**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `SUPABASE_URL`, `SUPABASE_KEY` are all set via `npx wrangler secret put` from `worker/`. Verify with `wrangler secret list`.
- **Cron runs every 5 minutes, not at the configured times.** The Worker checks the user's local time inside the handler via `Intl.DateTimeFormat`. This is deliberate so DST flips don't require code changes; don't switch to per-time cron expressions or you'll create a twice-yearly maintenance burden.
- Recharts dominates the bundle (~260kB gzipped total). Don't add another charting library; reuse the existing chart components or extend them.
- **Two Supabase keys, two roles, RLS is on.** RLS is enabled on `entries`, `push_settings`, and `push_subscriptions`. The SPA uses a **publishable key** (`sb_publishable_...`, in `VITE_SUPABASE_ANON_KEY`) that's subject to policy. The cron Worker uses a **secret key** (`sb_secret_...`, in the `SUPABASE_KEY` Wrangler secret) that bypasses RLS — necessary because the Worker has no user session and would otherwise read zero rows. Never paste the secret key into a `VITE_*` var or `.env` — it must live only in Wrangler. If you rotate keys, stay on the new `sb_publishable_` / `sb_secret_` system; the legacy `anon` / `service_role` JWTs share a JWT secret and can't be rotated independently.

- **Every SPA-writable table needs `anon` policies for SELECT *and* INSERT *and* UPDATE — not just the operations you think you're using.** `supabase-js` chains `.select()` after `upsert()` in this codebase (see [src/lib/settings.ts](src/lib/settings.ts), [src/lib/entries.ts](src/lib/entries.ts)), which sends `Prefer: return=representation` and triggers a SELECT-after-write to return the row. With RLS on, that post-write SELECT is evaluated against `anon`'s SELECT policy. If only INSERT/UPDATE policies exist for `anon`, the operation passes write evaluation but fails the SELECT-back and returns `401 / PostgREST error=42501` — the same shape as a denied write, which makes it easy to misdiagnose as a missing INSERT policy. When you add a new SPA-writable table, create three permissive policies for `anon`: SELECT, INSERT, and UPDATE (plus DELETE if the table is ever deleted from the client). Supabase dashboard templates default to `authenticated` roles, which won't help you — the publishable key authenticates as `anon`, not `authenticated`.
