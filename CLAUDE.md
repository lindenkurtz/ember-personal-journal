# CLAUDE.md

Project guidance for Claude Code when working in this repo. Keep it tight — only conventions that aren't obvious from reading the code.

## What this is

**Ember** — a single-user PWA journal for daily sleep / gym / deep work / social tracking. React + Vite SPA, Supabase persistence, deployed as a static site to Cloudflare Pages with one Pages Function for the Anthropic proxy. Auth is delegated to Cloudflare Access — there is no in-app login.

## Architecture (the parts worth knowing)

- **Two TypeScript projects.** The SPA (`src/`) uses DOM types; the Pages Function (`functions/`) uses `@cloudflare/workers-types`. They conflict if combined, so [tsconfig.json](tsconfig.json) is a solution-style references file pointing at [tsconfig.app.json](tsconfig.app.json) and [tsconfig.functions.json](tsconfig.functions.json). `tsc -b` builds both. If you add a file under `functions/`, it gets Workers types; under `src/`, DOM types.

- **Anthropic key never enters the browser.** All calls go through [functions/api/claude.ts](functions/api/claude.ts), which reads `ANTHROPIC_API_KEY` from the Pages env. Stream mode pipes Anthropic's SSE through unchanged — the client at [src/lib/claude.ts](src/lib/claude.ts) parses `content_block_delta` frames. The model is hardcoded as `MODEL` in the function; change it there, not in the SPA.

- **Supabase access goes through [src/lib/entries.ts](src/lib/entries.ts).** Never call `supabase.from('entries')` from a component. The schema is one row per `date`; morning and evening both `upsert` on the primary key, never insert duplicates.

- **Routing:** `/` = Dashboard, `/morning`, `/evening`, `/patterns`. `/dashboard` redirects to `/` for legacy links. Evening accepts `?date=YYYY-MM-DD` to back-fill a missed previous day.

## Conventions

- **Styling: hand-rolled CSS, no framework.** Each component has a sibling `.css` file (e.g. `StarRating.tsx` + `StarRating.css`). Class names are BEM-ish and component-prefixed (`.stars__btn`, `.qcard__question`). Theme tokens live in [src/styles/theme.css](src/styles/theme.css) — **never hardcode a color**; use `var(--amber)`, `var(--card)`, etc. Adding a new color? Add a token, not a one-off hex.

- **Journal-flow primitive.** Morning and Evening both use the same pattern: a `QuestionCard` with framer-motion fade between steps, `ProgressDots` up top, and the `morning__primary` / `morning__ghost` buttons at the bottom. Evening imports `Morning.css` for shared layout classes. If you build a third flow, factor out a `CheckInFlow` controller — don't fork the layout a third time.

- **Date keys** are ISO `YYYY-MM-DD` strings in the user's local timezone. Always go through [src/lib/date.ts](src/lib/date.ts) (`todayKey`, `dayKey`, `lastNDays`) — never `new Date().toISOString().slice(0, 10)` (that's UTC and will flip days for the user).

- **One useEffect, prefill draft, ignore errors gracefully.** Pages that read existing entries (Morning, Evening, Dashboard) seed their state from Supabase but never throw — if the network or config is broken, the UI still works for fresh input. Follow the pattern in [src/pages/Morning.tsx](src/pages/Morning.tsx) when adding new pages.

- **No comments restating what the code does.** Comments only explain *why* — a non-obvious constraint, a deliberate skip, a workaround. See the existing files for tone.

## Workflow

```bash
npm run dev              # SPA only, no /api/claude
npm run build            # tsc -b && vite build, outputs to dist/
npm run pages:dev        # wrangler pages dev dist — needed to exercise the Anthropic proxy
```

For the function locally, drop `ANTHROPIC_API_KEY=...` into `.dev.vars` (gitignored). For Supabase, `.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

After changes, **always run `npm run build`** — it typechecks both TS projects via `tsc -b` plus produces the Vite + PWA output. A passing build is the signal of correctness; there is no test suite by design (single-user, low blast radius).

## Gotchas

- The `VITE_` prefix matters. `VITE_*` env vars are bundled into the client; everything else is server-side only. Don't move the Anthropic key into a `VITE_*` var "for convenience."
- The service worker uses `registerType: 'autoUpdate'` with `registerSW({ immediate: true })`. On any deploy, the next navigation refreshes — no in-app prompt. Don't add one.
- `/api/*` is configured `NetworkOnly` in the Workbox runtime cache (see [vite.config.ts](vite.config.ts)). Don't cache Anthropic responses; the input changes every day.
- Recharts dominates the bundle (~260kB gzipped total). Don't add another charting library; reuse the existing chart components or extend them.
- Single user, no RLS on Supabase. If you ever expose this more broadly, the entries table needs `auth.uid()` policies — see the README schema.
