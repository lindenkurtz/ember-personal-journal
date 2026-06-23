import { supabase } from '../supabase'
import { monthRange } from '../date'
import type { FinanceTransaction } from '../../../shared/finance/types'

export type TransactionPatch = Partial<FinanceTransaction> & { id: string }

export async function getMonthTransactions(month: string): Promise<FinanceTransaction[]> {
  const { start, end } = monthRange(month)
  return getTransactionsRange(start, end)
}

export async function getTransactionsRange(start: string, end: string): Promise<FinanceTransaction[]> {
  const { data, error } = await supabase
    .from('finance_transactions')
    .select('*')
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: false })
  if (error) throw error
  return (data ?? []) as FinanceTransaction[]
}

export async function getReviewQueue(): Promise<FinanceTransaction[]> {
  const { data, error } = await supabase
    .from('finance_transactions')
    .select('*')
    .eq('flagged_for_review', true)
    .eq('reviewed', false)
    .order('date', { ascending: false })
  if (error) throw error
  return (data ?? []) as FinanceTransaction[]
}

export async function updateTransaction(patch: TransactionPatch): Promise<FinanceTransaction> {
  const { id, ...rest } = patch
  const { data, error } = await supabase
    .from('finance_transactions')
    .update({ ...rest, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as FinanceTransaction
}

/** Insert manual or CSV rows. `ignoreDuplicates` so re-importing a CSV is a no-op. */
export async function insertTransactions(rows: FinanceTransaction[]): Promise<number> {
  if (!rows.length) return 0
  const { error, count } = await supabase
    .from('finance_transactions')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true, count: 'exact' })
  if (error) throw error
  return count ?? 0
}

export async function deleteTransaction(id: string): Promise<void> {
  const { error } = await supabase.from('finance_transactions').delete().eq('id', id)
  if (error) throw error
}
