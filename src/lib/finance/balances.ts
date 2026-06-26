import { supabase } from '../supabase'
import type { FinanceBalance, NetWorthSnapshot } from '../../../shared/finance/types'

/** Most recent balance per account (newest as_of wins). */
export async function getLatestBalances(): Promise<Map<string, FinanceBalance>> {
  const { data, error } = await supabase
    .from('finance_balances')
    .select('account_id, as_of, balance')
    .order('as_of', { ascending: false })
  if (error) throw error
  const latest = new Map<string, FinanceBalance>()
  for (const b of (data ?? []) as FinanceBalance[]) {
    if (!latest.has(b.account_id)) latest.set(b.account_id, b)
  }
  return latest
}

/** Full per-account balance history (one row per account per sync day), oldest first. */
export async function getBalanceHistory(): Promise<FinanceBalance[]> {
  const { data, error } = await supabase
    .from('finance_balances')
    .select('account_id, as_of, balance')
    .order('as_of', { ascending: true })
  if (error) throw error
  return (data ?? []) as FinanceBalance[]
}

export async function getNetWorthSnapshots(): Promise<NetWorthSnapshot[]> {
  const { data, error } = await supabase
    .from('finance_net_worth_snapshots')
    .select('as_of, net_worth, assets_total, liabilities_total')
    .order('as_of', { ascending: true })
  if (error) throw error
  return (data ?? []) as NetWorthSnapshot[]
}
