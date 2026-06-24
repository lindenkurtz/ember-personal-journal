import { supabase } from '../supabase'
import type { Category, FinanceRule, SavingsBucket } from '../../../shared/finance/types'

export interface NewRule {
  match_text: string
  category: Category
  note: string | null
  savings_bucket: SavingsBucket | null
}

export async function getRules(): Promise<FinanceRule[]> {
  const { data, error } = await supabase
    .from('finance_rules')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as FinanceRule[]
}

export async function createRule(rule: NewRule): Promise<FinanceRule> {
  const { data, error } = await supabase
    .from('finance_rules')
    .insert({ ...rule, match_text: rule.match_text.trim().toLowerCase() })
    .select()
    .single()
  if (error) throw error
  return data as FinanceRule
}

export async function deleteRule(id: number): Promise<void> {
  const { error } = await supabase.from('finance_rules').delete().eq('id', id)
  if (error) throw error
}
