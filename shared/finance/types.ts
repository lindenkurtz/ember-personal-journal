// Runtime-agnostic finance types, shared by the SPA, the Pages Function, and
// the cron Worker. Keep this file free of DOM- and Workers-only globals so all
// three TypeScript projects can compile it.

export type Category =
  | 'income'
  | 'transfer'
  | 'housing'
  | 'groceries'
  | 'dining'
  | 'subscriptions'
  | 'health'
  | 'transportation'
  | 'school_work'
  | 'shopping'
  | 'peer_payment'

export type FinanceSource = 'plaid' | 'csv' | 'manual'

export type SavingsBucket = 'short_term' | 'long_term' | 'retirement'

export interface FinanceAccount {
  account_id: string
  item_id: string | null
  name: string
  official_name: string | null
  institution_name: string | null
  type: string | null
  subtype: string | null
  mask: string | null
  is_asset: boolean
  include_in_net_worth: boolean
  source: FinanceSource
  last_synced_at: string | null
}

export interface FinanceTransaction {
  id: string
  account_id: string | null
  date: string // YYYY-MM-DD
  amount: number // inflow positive, outflow negative
  merchant_name: string | null
  name: string | null
  plaid_category: string | null
  category: Category
  notes: string | null
  is_transfer: boolean
  is_split: boolean
  split_amount: number | null
  // Labels a transfer as a savings/retirement contribution so it feeds the
  // savings-rate panel. Independent of is_transfer (a savings move is still a
  // transfer for cash-flow purposes). null = not a savings contribution.
  savings_bucket: SavingsBucket | null
  // Free-text payer label that splits the income bar (e.g. 'AcmeCorp').
  // Only meaningful on income rows; null = the "Misc" bucket. Open-ended by
  // design — a new income stream is a new rule, never a code/enum change.
  income_source: string | null
  flagged_for_review: boolean
  reviewed: boolean
  source: FinanceSource
  pending: boolean
  created_at?: string
  updated_at?: string
}

export interface FinanceBalance {
  account_id: string
  as_of: string
  balance: number
}

export interface NetWorthSnapshot {
  as_of: string
  net_worth: number
  assets_total: number
  liabilities_total: number
}

export interface LoanBalance {
  as_of: string
  servicer: string
  balance: number
  source: FinanceSource
}

export interface FinanceSettings {
  id: number
  plaid_env: string
  cc_payment_payee: string | null
  wf_buffer_target: number
  secondary_buffer_target: number
  last_full_sync_date: string | null
}

// A user-defined classification rule. `match_text` is a lowercased substring
// tested against a transaction's merchant_name + name; the first matching rule
// wins and stamps its category/note/savings_bucket. Created from a single
// transaction in the editor, applied to all future matches.
export interface FinanceRule {
  id: number
  match_text: string
  category: Category
  note: string | null
  savings_bucket: SavingsBucket | null
  income_source: string | null
  created_at?: string
}

export interface SyncSummary {
  accounts: number
  added: number
  modified: number
  removed: number
  net_worth: number | null
  errors: string[]
}
