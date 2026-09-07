import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { FinanceAccount, FinanceSettings, SyncSummary } from './types'
import { computeNetWorth } from './networth'
import { PlaidAccount, getBalances, getLiabilities, PlaidError } from './plaidApi'

// One env shape for both callers. The Pages Function maps its
// SUPABASE_SERVICE_KEY into SUPABASE_KEY; the cron Worker already uses
// SUPABASE_KEY. Both keys are the RLS-bypassing secret key.
export interface SyncEnv {
  PLAID_CLIENT_ID: string
  PLAID_SECRET: string
  PLAID_ENV: string
  SUPABASE_URL: string
  SUPABASE_KEY: string
}

interface ItemRow {
  item_id: string
  access_token: string
  institution_name: string | null
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function defaultAssetFlags(type: string | null): { is_asset: boolean; include: boolean } {
  const isAsset = type !== 'credit' && type !== 'loan'
  return { is_asset: isAsset, include: isAsset }
}

export async function runSync(env: SyncEnv, asOf: string = utcToday()): Promise<SyncSummary> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY, { auth: { persistSession: false } })
  const plaidEnv = { PLAID_CLIENT_ID: env.PLAID_CLIENT_ID, PLAID_SECRET: env.PLAID_SECRET, PLAID_ENV: env.PLAID_ENV }
  const summary: SyncSummary = { accounts: 0, net_worth: null, errors: [] }

  const [{ data: itemRows }, { data: acctRows }, { data: settingsRow }] = await Promise.all([
    supabase.from('finance_plaid_items').select('item_id, access_token, institution_name'),
    supabase.from('finance_accounts').select('*'),
    supabase.from('finance_settings').select('loan_servicer').eq('id', 1).maybeSingle()
  ])

  const items = (itemRows ?? []) as ItemRow[]
  const accountsById = new Map<string, FinanceAccount>()
  for (const a of (acctRows ?? []) as FinanceAccount[]) accountsById.set(a.account_id, a)
  const settings = settingsRow as Pick<FinanceSettings, 'loan_servicer'> | null

  const balanceRows: { account_id: string; as_of: string; balance: number; synced_at: string }[] = []
  const nowIso = new Date().toISOString()

  for (const item of items) {
    // 1. Balances — also discovers/refreshes account metadata.
    try {
      const { accounts } = await getBalances(plaidEnv, item.access_token)
      for (const pa of accounts) {
        await ensureAccount(supabase, accountsById, pa, item)
        const bal = pa.balances.current
        if (bal != null) balanceRows.push({ account_id: pa.account_id, as_of: asOf, balance: bal, synced_at: nowIso })
      }
      summary.accounts += accounts.length
    } catch (e) {
      summary.errors.push(`balances ${item.item_id}: ${String(e)}`)
    }

    // 2. Liabilities. Tolerated when an institution doesn't support the endpoint.
    // `servicer` is the upsert key and the net-worth rollup sums one balance per
    // distinct servicer, so it has to stay byte-stable across syncs or an old
    // spelling lingers forever and double-counts. That makes it configuration,
    // not something derived per-sync from the Plaid payload: skip the write
    // rather than invent a name when finance_settings.loan_servicer is unset.
    const servicer = settings?.loan_servicer
    if (servicer) {
      try {
        const { accounts, liabilities } = await getLiabilities(plaidEnv, item.access_token)
        const student = liabilities?.student ?? []
        for (const loan of student) {
          const acct = accounts.find((a) => a.account_id === loan.account_id)
          const bal = acct?.balances.current
          if (bal != null) {
            await supabase
              .from('finance_loan_balances')
              .upsert({ as_of: asOf, servicer, balance: bal, source: 'plaid' }, { onConflict: 'servicer,as_of' })
          }
        }
      } catch (e) {
        if (!(e instanceof PlaidError) || e.status >= 500) summary.errors.push(`liabilities ${item.item_id}: ${String(e)}`)
      }
    }
  }

  if (balanceRows.length) {
    await supabase.from('finance_balances').upsert(balanceRows, { onConflict: 'account_id,as_of' })
  }

  summary.net_worth = await snapshotNetWorth(supabase, Array.from(accountsById.values()), asOf)

  await supabase.from('finance_settings').update({ last_full_sync_date: asOf }).eq('id', 1)
  await supabase.from('finance_accounts').update({ last_synced_at: nowIso }).not('account_id', 'is', null)

  return summary
}

async function ensureAccount(
  supabase: SupabaseClient,
  accountsById: Map<string, FinanceAccount>,
  pa: PlaidAccount,
  item: ItemRow
): Promise<void> {
  const existing = accountsById.get(pa.account_id)
  if (existing) {
    // Refresh Plaid-owned metadata only; never clobber the user's
    // include_in_net_worth / is_asset toggles.
    await supabase
      .from('finance_accounts')
      .update({
        name: existing.name || pa.name,
        official_name: pa.official_name,
        type: pa.type,
        subtype: pa.subtype,
        mask: pa.mask
      })
      .eq('account_id', pa.account_id)
    return
  }
  const flags = defaultAssetFlags(pa.type)
  const row: FinanceAccount = {
    account_id: pa.account_id,
    item_id: item.item_id,
    name: pa.name,
    official_name: pa.official_name,
    institution_name: item.institution_name,
    type: pa.type,
    subtype: pa.subtype,
    mask: pa.mask,
    is_asset: flags.is_asset,
    include_in_net_worth: flags.include,
    source: 'plaid',
    last_synced_at: null
  }
  await supabase.from('finance_accounts').upsert(row, { onConflict: 'account_id' })
  accountsById.set(pa.account_id, row)
}

async function snapshotNetWorth(
  supabase: SupabaseClient,
  accounts: FinanceAccount[],
  asOf: string
): Promise<number> {
  // Latest balance per account (as of today or the most recent prior sync).
  const { data: balRows } = await supabase
    .from('finance_balances')
    .select('account_id, as_of, balance')
    .order('as_of', { ascending: false })
  const latest = new Map<string, number>()
  for (const b of (balRows ?? []) as { account_id: string; balance: number }[]) {
    if (!latest.has(b.account_id)) latest.set(b.account_id, b.balance)
  }

  const { data: loanRows } = await supabase
    .from('finance_loan_balances')
    .select('balance, as_of, servicer')
    .order('as_of', { ascending: false })
  const latestLoanByServicer = new Map<string, number>()
  for (const l of (loanRows ?? []) as { servicer: string; balance: number }[]) {
    if (!latestLoanByServicer.has(l.servicer)) latestLoanByServicer.set(l.servicer, l.balance)
  }
  let liabilityTotal = 0
  for (const v of latestLoanByServicer.values()) liabilityTotal += v

  const nw = computeNetWorth(accounts, latest, liabilityTotal)
  await supabase.from('finance_net_worth_snapshots').upsert(
    {
      as_of: asOf,
      net_worth: nw.net_worth,
      assets_total: nw.assets_total,
      liabilities_total: nw.liabilities_total,
      synced_at: new Date().toISOString()
    },
    { onConflict: 'as_of' }
  )
  return nw.net_worth
}
