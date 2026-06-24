import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { FinanceAccount, FinanceRule, SyncSummary } from './types'
import { classify } from './classify'
import { computeNetWorth } from './networth'
import {
  PlaidAccount,
  PlaidTransaction,
  getBalances,
  getLiabilities,
  transactionsSync,
  PlaidError
} from './plaidApi'

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
  transactions_cursor: string | null
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

// Plaid amount is positive for outflows; we store inflow-positive.
function signedAmount(t: PlaidTransaction): number {
  return -t.amount
}

function defaultAssetFlags(type: string | null): { is_asset: boolean; include: boolean } {
  const isAsset = type !== 'credit' && type !== 'loan'
  return { is_asset: isAsset, include: isAsset }
}

export async function runSync(env: SyncEnv, asOf: string = utcToday()): Promise<SyncSummary> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY, { auth: { persistSession: false } })
  const plaidEnv = { PLAID_CLIENT_ID: env.PLAID_CLIENT_ID, PLAID_SECRET: env.PLAID_SECRET, PLAID_ENV: env.PLAID_ENV }
  const summary: SyncSummary = { accounts: 0, added: 0, modified: 0, removed: 0, net_worth: null, errors: [] }

  const [{ data: itemRows }, { data: acctRows }, { data: ruleRows }] = await Promise.all([
    supabase.from('finance_plaid_items').select('item_id, access_token, institution_name, transactions_cursor'),
    supabase.from('finance_accounts').select('*'),
    supabase.from('finance_rules').select('*')
  ])

  const items = (itemRows ?? []) as ItemRow[]
  const accountsById = new Map<string, FinanceAccount>()
  for (const a of (acctRows ?? []) as FinanceAccount[]) accountsById.set(a.account_id, a)
  const rules = (ruleRows ?? []) as FinanceRule[]

  const incoming: PlaidTransaction[] = []
  const removedIds: string[] = []
  const balanceRows: { account_id: string; as_of: string; balance: number; synced_at: string }[] = []
  const nowIso = new Date().toISOString()

  for (const item of items) {
    // 1. Transactions — cursor-based, paginated.
    try {
      let cursor = item.transactions_cursor
      let hasMore = true
      while (hasMore) {
        const page = await transactionsSync(plaidEnv, item.access_token, cursor)
        incoming.push(...page.added, ...page.modified)
        summary.added += page.added.length
        summary.modified += page.modified.length
        for (const r of page.removed) removedIds.push(r.transaction_id)
        cursor = page.next_cursor
        hasMore = page.has_more
      }
      await supabase.from('finance_plaid_items').update({ transactions_cursor: cursor }).eq('item_id', item.item_id)
    } catch (e) {
      summary.errors.push(`transactions ${item.item_id}: ${String(e)}`)
    }

    // 2. Balances — also discovers/refreshes account metadata.
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

    // 3. Liabilities — Servicer. Tolerated when an institution doesn't support it.
    try {
      const { accounts, liabilities } = await getLiabilities(plaidEnv, item.access_token)
      const student = liabilities?.student ?? []
      for (const loan of student) {
        const acct = accounts.find((a) => a.account_id === loan.account_id)
        const bal = acct?.balances.current
        if (bal != null) {
          await supabase
            .from('finance_loan_balances')
            .upsert({ as_of: asOf, servicer: 'Servicer', balance: bal, source: 'plaid' }, { onConflict: 'servicer,as_of' })
        }
      }
    } catch (e) {
      if (!(e instanceof PlaidError) || e.status >= 500) summary.errors.push(`liabilities ${item.item_id}: ${String(e)}`)
    }
  }

  await upsertTransactions(supabase, incoming, accountsById, rules)

  if (removedIds.length) {
    await supabase.from('finance_transactions').delete().in('id', removedIds)
    summary.removed += removedIds.length
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

async function upsertTransactions(
  supabase: SupabaseClient,
  incoming: PlaidTransaction[],
  accountsById: Map<string, FinanceAccount>,
  rules: FinanceRule[]
): Promise<void> {
  if (!incoming.length) return
  const ids = incoming.map((t) => t.transaction_id)
  const { data: existingRows } = await supabase
    .from('finance_transactions')
    .select('id, category, notes, is_transfer, is_split, split_amount, savings_bucket, flagged_for_review, reviewed')
    .in('id', ids)
  const existing = new Map<string, any>()
  for (const r of (existingRows ?? []) as any[]) existing.set(r.id, r)

  const payload = incoming.map((t) => {
    const prior = existing.get(t.transaction_id)
    const base = {
      id: t.transaction_id,
      account_id: t.account_id,
      date: t.date,
      amount: signedAmount(t),
      merchant_name: t.merchant_name,
      name: t.name,
      plaid_category: t.personal_finance_category?.detailed ?? t.personal_finance_category?.primary ?? null,
      pending: t.pending,
      source: 'plaid' as const,
      updated_at: new Date().toISOString()
    }
    // Preserve the user's edits on rows they've already reviewed.
    if (prior && prior.reviewed) {
      return {
        ...base,
        category: prior.category,
        notes: prior.notes,
        is_transfer: prior.is_transfer,
        is_split: prior.is_split,
        split_amount: prior.split_amount,
        savings_bucket: prior.savings_bucket,
        flagged_for_review: prior.flagged_for_review,
        reviewed: true
      }
    }
    const c = classify(
      {
        name: t.name,
        merchant_name: t.merchant_name,
        amount: signedAmount(t),
        pfc_primary: t.personal_finance_category?.primary,
        pfc_detailed: t.personal_finance_category?.detailed
      },
      accountsById.get(t.account_id),
      { rules }
    )
    return {
      ...base,
      category: c.category,
      notes: c.notes,
      is_transfer: c.is_transfer,
      is_split: false,
      split_amount: null,
      savings_bucket: c.savings_bucket,
      flagged_for_review: c.flagged_for_review,
      reviewed: c.reviewed
    }
  })

  await supabase.from('finance_transactions').upsert(payload, { onConflict: 'id' })
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
