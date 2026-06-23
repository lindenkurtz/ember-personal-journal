import { supabase } from '../supabase'
import { todayKey } from '../date'
import type { LoanBalance } from '../../../shared/finance/types'

export async function getLatestLoan(servicer = 'Servicer'): Promise<LoanBalance | null> {
  const { data, error } = await supabase
    .from('finance_loan_balances')
    .select('as_of, servicer, balance, source')
    .eq('servicer', servicer)
    .order('as_of', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as LoanBalance | null) ?? null
}

/** Manual Servicer balance entry — the fallback when Plaid Liabilities is unavailable. */
export async function setManualLoan(balance: number, servicer = 'Servicer'): Promise<LoanBalance> {
  const { data, error } = await supabase
    .from('finance_loan_balances')
    .upsert({ as_of: todayKey(), servicer, balance, source: 'manual' }, { onConflict: 'servicer,as_of' })
    .select()
    .single()
  if (error) throw error
  return data as LoanBalance
}
