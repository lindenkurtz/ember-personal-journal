# Finance feature — setup & operations

A net-worth tracker at `/finance`: Plaid-synced account balances, loan balances,
and a daily net-worth snapshot charted over time. Pure visibility — no budgets or
alerts.

**Scope note (Sept 2026).** This page used to do a great deal more — transaction
ingest and classification, screenshot import for two manually-tracked card/cash
accounts Plaid can't reach, a review queue, user-authored rules, monthly
cash-flow and category panels, and savings-rate tracking. All of it was retired unused. Following the repo's
retirement precedent, the tables and every row in them are **permanent** — see
the header of [supabase/finance_migration.sql](../supabase/finance_migration.sql) —
but nothing reads or writes them any more.

## One-time setup

### 1. Database
Run [supabase/finance_migration.sql](../supabase/finance_migration.sql) in the
Supabase SQL editor. It creates the `finance_*` tables and RLS policies.
Verify afterward:
- `finance_plaid_items` has **no** anon policy (server-only; holds access tokens).
- Every other `finance_*` table has anon SELECT plus the write verbs it needs.

### 2. Plaid account (none yet)
1. Sign up at https://dashboard.plaid.com/signup.
2. Grab **Client ID** and the **Sandbox secret** (Team Settings → Keys).
3. Build/test against Sandbox first (fake banks, free, unlimited).
4. When ready for real data, submit a **Production access request** in the
   dashboard and swap `PLAID_ENV` to `production` with the Production secret.
5. Add the OAuth **redirect URI** `https://<your-pages-domain>/finance` under
   Team Settings → API → Allowed redirect URIs (needed for banks that use an
   OAuth handoff).

### 3. Environment variables

**Cloudflare Pages** (Settings → Environment variables — server-side, no `VITE_`):
| Var | Value |
| --- | --- |
| `PLAID_CLIENT_ID` | Plaid client id |
| `PLAID_SECRET` | Plaid secret for the active env |
| `PLAID_ENV` | `sandbox` or `production` |
| `SUPABASE_URL` | same project URL |
| `SUPABASE_SERVICE_KEY` | the `sb_secret_…` key (bypasses RLS) |

**Local Pages dev** — add the same five to `.dev.vars` in the repo root, then
`npm run build && npm run pages:dev` to exercise `/api/plaid/*`.

**Cron Worker** (from `worker/`, optional — daily auto-sync is skipped without
Plaid creds):
```bash
npx wrangler secret put PLAID_CLIENT_ID
npx wrangler secret put PLAID_SECRET
npx wrangler secret put PLAID_ENV
```
`SUPABASE_URL` / `SUPABASE_KEY` are already set; `SUPABASE_KEY` must be the
`sb_secret_…` key so the Worker can read tokens and write finance tables.

## How it works

- **Plaid is called via raw REST** ([shared/finance/plaidApi.ts](../shared/finance/plaidApi.ts)),
  not the Node SDK (which won't run on Workers).
- **One sync implementation** ([shared/finance/sync.ts](../shared/finance/sync.ts),
  `runSync`) is shared by the manual "Sync now" Pages Function
  ([functions/api/plaid/sync.ts](../functions/api/plaid/sync.ts)) and the daily
  cron Worker ([worker/src/index.ts](../worker/src/index.ts) → `financeTick`,
  deduped once per local day).
- **Each sync** pulls `/accounts/balance/get` per item (which also discovers and
  refreshes account metadata, never clobbering your `include_in_net_worth` /
  `is_asset` toggles), then `/liabilities/get` opportunistically, then writes one
  `finance_balances` row per account per day and one net-worth snapshot.
- **Net worth** = included asset balances − loan balances, snapshotted each sync.
  Toggle an account in or out by tapping it in the Accounts card.
- **Link asks for `balance` only.** Transaction ingest is gone, so
  `createLinkToken` no longer requests the `transactions` product. Items linked
  before Sept 2026 keep whatever scope they were created with — this narrows
  future links, it does not re-scope existing ones.

## Naming your own institutions

**No bank, brokerage, or loan servicer is named anywhere in this repo** — the
repo is public. The one place the app still needs a name, it reads from
`finance_settings` (singleton row, id = 1):

| Column | What to put there |
| --- | --- |
| `loan_servicer` | Display name for your loan, e.g. on `/finance` and as the write key for `finance_loan_balances`. Null skips the Plaid liabilities write entirely. |

`brokerage_match` and `cc_payment_payee` are still columns on that table but are
classification-era leftovers — nothing reads them. Leave them as they are.

`loan_servicer` is also the **upsert key** for loan rows and the net-worth
rollup sums the latest balance per distinct servicer — so change it and the old
rows are stranded under the old name and counted on top of the new ones. The
migration seeds it from your existing loan data for exactly this reason; set it
once and leave it.

## Testing (Sandbox)

1. `npm run build && npm run pages:dev`.
2. Open `/finance` → **Connect account** → pick a bank → Plaid Sandbox creds
   `user_good` / `pass_good`.
3. **Sync now** → confirm account balances, a net-worth snapshot, and that the
   chart's per-account dropdown lists the linked accounts.
4. Daily cron: `cd worker && npm run tick`, then hit `/?force=finance` to fire a
   sync immediately; a second call the same day is a no-op (dedup).
