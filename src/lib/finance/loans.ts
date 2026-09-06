import { supabase } from '../supabase'
import { todayKey } from '../date'
import type { LoanBalance } from '../../../shared/finance/types'

/**
 * Most recent loan balance, whichever servicer it belongs to. The servicer name
 * is user data (it lives on the row and in finance_settings.loan_servicer), not
 * a constant — so this reads the latest row rather than filtering by a name the
 * SPA would have to hardcode.
 */
export async function getLatestLoan(): Promise<LoanBalance | null> {
  const { data, error } = await supabase
    .from('finance_loan_balances')
    .select('as_of, servicer, balance, source')
    .order('as_of', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as LoanBalance | null) ?? null
}

/** Manual balance entry — the fallback when Plaid Liabilities is unavailable. */
export async function setManualLoan(balance: number, servicer: string): Promise<LoanBalance> {
  const { data, error } = await supabase
    .from('finance_loan_balances')
    .upsert({ as_of: todayKey(), servicer, balance, source: 'manual' }, { onConflict: 'servicer,as_of' })
    .select()
    .single()
  if (error) throw error
  return data as LoanBalance
}
