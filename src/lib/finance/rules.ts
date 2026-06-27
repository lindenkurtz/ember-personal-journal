import { supabase } from '../supabase'
import type { Category, FinanceRule, SavingsBucket } from '../../../shared/finance/types'

export interface NewRule {
  match_text: string
  category: Category
  note: string | null
  savings_bucket: SavingsBucket | null
  income_source: string | null
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

/**
 * Create or replace the rule for a given match_text. Keyed on match_text so
 * re-learning a Brokerage destination (or re-saving the same "always classify"
 * rule) overwrites rather than piling up duplicate rules that race on order.
 */
export async function upsertRuleByMatch(rule: NewRule): Promise<FinanceRule> {
  const match_text = rule.match_text.trim().toLowerCase()
  await supabase.from('finance_rules').delete().eq('match_text', match_text)
  const { data, error } = await supabase
    .from('finance_rules')
    .insert({ ...rule, match_text })
    .select()
    .single()
  if (error) throw error
  return data as FinanceRule
}

export async function deleteRule(id: number): Promise<void> {
  const { error } = await supabase.from('finance_rules').delete().eq('id', id)
  if (error) throw error
}
