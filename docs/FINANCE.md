# Finance feature — setup & operations

A personal finance dashboard at `/finance`: Plaid-synced balances/transactions,
Apple Card CSV import, transaction classification + review queue, and net-worth
snapshots charted over time. Pure visibility — no budgets or alerts.

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
   Team Settings → API → Allowed redirect URIs (needed for banks like Wells
   Fargo that use OAuth).

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
- **Classification** ([shared/finance/classify.ts](../shared/finance/classify.ts)):
  Venmo/peer → review queue; Apple Cash→a family payee → Credit Card Payment (transfer);
  Apple Cash cash-back → income; Plaid transfers → internal transfers; otherwise
  the Plaid category map. User edits on a `reviewed` row are never clobbered by
  a re-sync.
- **Net worth** = included asset balances − Servicer, snapshotted each sync.
- **Apple Card** is CSV-first ([src/lib/finance/csv.ts](../src/lib/finance/csv.ts)),
  excluded from net worth. Import via the page's "Import Apple Card CSV" button;
  re-importing the same export is a no-op (deterministic ids).

## Testing (Sandbox)

1. `npm run build && npm run pages:dev`.
2. Open `/finance` → **Connect account** → pick a bank → Plaid Sandbox creds
   `user_good` / `pass_good`.
3. **Sync now** → confirm balances, transactions, a net-worth snapshot, and that
   Venmo/peer items land in the review queue.
4. Import a sample Apple Card CSV → rows appear, balance excluded from net worth.
5. Daily cron: `cd worker && npm run tick`, then hit `/?force=finance` to fire a
   sync immediately; a second call the same day is a no-op (dedup).
