# Finance feature — setup & operations

A personal finance dashboard at `/finance`: Plaid-synced balances/transactions,
Apple Card / Apple Cash import by screenshot, transaction classification +
review queue, and net-worth snapshots charted over time. Pure visibility — no
budgets or alerts.

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
- **Apple Card / Apple Cash are screenshot-only.** Plaid can't reach them and,
  as a Family participant, the user can't CSV-export either. Both are synthetic
  accounts defined in [src/lib/finance/localAccounts.ts](../src/lib/finance/localAccounts.ts)
  and excluded from net worth (Apple Card isn't the user's liability; Apple Cash
  has no connected balance to snapshot) — their transactions still feed spending
  and cash flow. To import: **Add from screenshot** on `/finance`, pick the
  account, upload screenshots of the Wallet / card.apple.com transaction list.
  Claude (through the `/api/claude` vision proxy,
  [src/lib/finance/extract.ts](../src/lib/finance/extract.ts)) returns rows tagged
  with our categories; you review them, then confirm to insert. Re-importing the
  same screenshot is a no-op — ids are a content hash
  ([src/lib/finance/hash.ts](../src/lib/finance/hash.ts)). Cost is ~2¢/screenshot.
  Note the Apple Card account id is still `csv-apple-card` and its `source` is
  `'csv'`: those are frozen strings that keep existing rows joined, not a live
  CSV path. Don't "fix" them.
- **Savings rates** are read off each transaction's `savings_bucket`
  (`short_term` = Brokerage Emergency, `long_term` = Investments/Savings,
  `retirement` = Roth IRA). It auto-sets when money lands in a matched Brokerage
  account; if those accounts aren't connected, label the Bank-outflow
  transfer manually in the transaction editor. One label per transfer, so it's
  never double-counted.

## Testing (Sandbox)

1. `npm run build && npm run pages:dev`.
2. Open `/finance` → **Connect account** → pick a bank → Plaid Sandbox creds
   `user_good` / `pass_good`.
3. **Sync now** → confirm balances, transactions, a net-worth snapshot, and that
   Venmo/peer items land in the review queue.
4. **Add from screenshot** with any Apple Card / Apple Cash screenshot → rows
   appear in the review sheet; confirm, then re-upload the same image and check
   that nothing duplicates.
5. Daily cron: `cd worker && npm run tick`, then hit `/?force=finance` to fire a
   sync immediately; a second call the same day is a no-op (dedup).
