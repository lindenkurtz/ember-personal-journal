import { supabase } from '../supabase'
import type { FinanceSettings } from '../../../shared/finance/types'

const COLUMNS = 'id, plaid_env, cc_payment_payee, wf_buffer_target, secondary_buffer_target, last_full_sync_date'

const DEFAULTS: FinanceSettings = {
  id: 1,
  plaid_env: 'sandbox',
  cc_payment_payee: null,
  wf_buffer_target: 100,
  secondary_buffer_target: 75,
  last_full_sync_date: null
}

export async function getFinanceSettings(): Promise<FinanceSettings> {
  const { data, error } = await supabase
    .from('finance_settings')
    .select(COLUMNS)
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  return (data as FinanceSettings | null) ?? DEFAULTS
}
