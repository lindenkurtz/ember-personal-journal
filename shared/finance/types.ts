// Runtime-agnostic finance types, shared by the SPA, the Pages Function, and
// the cron Worker. Keep this file free of DOM- and Workers-only globals so all
// three TypeScript projects can compile it.
//
// Transaction ingest and classification were retired (Sept 2026). The
// `finance_transactions` / `finance_rules` tables and their rows are permanent —
// see the note in supabase/finance_migration.sql — but nothing types, reads, or
// writes them any more, so the Category / FinanceTransaction / FinanceRule /
// SavingsBucket types are gone with the code that used them.

export type FinanceSource = 'plaid' | 'csv' | 'manual'

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
  // Display name of the loan servicer behind finance_loan_balances. Null = no
  // loan tracked. Doubles as the write key, so changing it strands existing rows.
  loan_servicer: string | null
  // Semester start dates ('YYYY-MM-DD') driving the Dashboard's per-term loan
  // reminder. Null/empty = no reminder. Config, not a constant: an academic
  // calendar identifies a school and this repo is public.
  semester_starts: string[] | null
  last_full_sync_date: string | null
}

export interface SyncSummary {
  accounts: number
  net_worth: number | null
  errors: string[]
}
