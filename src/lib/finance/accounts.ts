import { supabase } from '../supabase'
import type { FinanceAccount } from '../../../shared/finance/types'

export type AccountPatch = Partial<FinanceAccount> & { account_id: string }

export async function getAccounts(): Promise<FinanceAccount[]> {
  const { data, error } = await supabase
    .from('finance_accounts')
    .select('*')
    .order('institution_name', { ascending: true })
  if (error) throw error
  return (data ?? []) as FinanceAccount[]
}

export async function updateAccount(patch: AccountPatch): Promise<FinanceAccount> {
  const { account_id, ...rest } = patch
  const { data, error } = await supabase
    .from('finance_accounts')
    .update(rest)
    .eq('account_id', account_id)
    .select()
    .single()
  if (error) throw error
  return data as FinanceAccount
}

/** Upsert a non-Plaid account (the synthetic Apple Card CSV account). */
export async function ensureLocalAccount(row: FinanceAccount): Promise<void> {
  const { error } = await supabase
    .from('finance_accounts')
    .upsert(row, { onConflict: 'account_id', ignoreDuplicates: true })
  if (error) throw error
}
