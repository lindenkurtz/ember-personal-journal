import type { Category, FinanceTransaction } from '../../../shared/finance/types'

// Transfers and income are never "spending". Peer payments still count toward
// spending once reviewed (the user recategorizes splits during review).
export function isSpending(category: Category): boolean {
  return category !== 'transfer' && category !== 'income'
}

export interface CashFlow {
  income: number
  expenses: number
  net: number
}

export function cashFlow(txns: FinanceTransaction[]): CashFlow {
  let income = 0
  let expenses = 0
  for (const t of txns) {
    if (t.is_transfer || t.category === 'transfer') continue
    if (t.category === 'income') income += t.amount
    else if (t.amount < 0) expenses += -t.amount
  }
  return { income, expenses, net: income - expenses }
}

// Income transactions with no `income_source` fall into this bucket. It's a
// display label, not a stored value (a null income_source is the Misc bucket).
export const MISC_INCOME = 'Misc'

export interface IncomeSlice {
  source: string
  total: number
}

/**
 * Income split by payer label, largest first, with Misc always pinned last.
 * Labels are discovered from the data (`income_source`), never enumerated in
 * code — a new income stream appears as soon as a rule stamps it. The summed
 * totals equal `cashFlow().income` so the stacked bar matches the income total.
 */
export function incomeBySource(txns: FinanceTransaction[]): IncomeSlice[] {
  const map = new Map<string, number>()
  for (const t of txns) {
    if (t.is_transfer || t.category !== 'income') continue
    const source = t.income_source?.trim() || MISC_INCOME
    map.set(source, (map.get(source) ?? 0) + t.amount)
  }
  return [...map.entries()]
    .map(([source, total]) => ({ source, total }))
    .sort((a, b) => {
      if (a.source === MISC_INCOME) return 1
      if (b.source === MISC_INCOME) return -1
      return b.total - a.total
    })
}

export interface CategorySlice {
  category: Category
  total: number
}

/** Spending per category (positive dollars out), largest first. Transfers/income excluded. */
export function categoryBreakdown(txns: FinanceTransaction[]): CategorySlice[] {
  const map = new Map<Category, number>()
  for (const t of txns) {
    if (t.is_transfer || !isSpending(t.category) || t.amount >= 0) continue
    map.set(t.category, (map.get(t.category) ?? 0) + -t.amount)
  }
  return [...map.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total)
}

export interface SavingsRates {
  shortTerm: number // Brokerage Emergency
  longTerm: number // Brokerage Savings/Investments
  retirement: number // Brokerage Roth IRA
  shortTermRate: number | null
  longTermRate: number | null
  retirementRate: number | null
}

/**
 * Three separate savings figures — deliberately NOT smoothed. Internship summers
 * vs school months swing hard and that swing is the signal. Each contribution is
 * read off the transaction's `savings_bucket` label (auto-set when money lands in
 * a matched Brokerage account, or set manually on the source-side transfer), so a
 * given transfer is counted once regardless of which side is connected.
 */
export function savingsRates(txns: FinanceTransaction[], income: number): SavingsRates {
  let shortTerm = 0
  let longTerm = 0
  let retirement = 0
  for (const t of txns) {
    if (t.savings_bucket === 'short_term') shortTerm += Math.abs(t.amount)
    else if (t.savings_bucket === 'long_term') longTerm += Math.abs(t.amount)
    else if (t.savings_bucket === 'retirement') retirement += Math.abs(t.amount)
  }
  return {
    shortTerm,
    longTerm,
    retirement,
    shortTermRate: income > 0 ? shortTerm / income : null,
    longTermRate: income > 0 ? longTerm / income : null,
    retirementRate: income > 0 ? retirement / income : null
  }
}
