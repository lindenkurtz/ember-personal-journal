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

/**
 * The semester whose loan check-in is still outstanding, or null if none is.
 *
 * Returns the most recent start date on or before `today` when no loan balance
 * has been recorded since — so the Dashboard card appears once a term begins
 * and clears the moment a balance is written, rather than being dismissed. Only
 * the current term can be outstanding: a semester the user skipped is water
 * under the bridge once the next one starts, and re-nagging for it would never
 * clear.
 *
 * `starts` is user config (finance_settings.semester_starts) and runs out after
 * the last term, which is what ends the reminders. ISO date keys compare
 * correctly as strings.
 */
export function semesterLoanDue(
  starts: string[] | null,
  latest: LoanBalance | null,
  today: string = todayKey()
): string | null {
  if (!starts?.length) return null
  const begun = starts.filter((s) => s <= today).sort()
  if (!begun.length) return null
  const current = begun[begun.length - 1]
  if (latest && latest.as_of >= current) return null
  return current
}
