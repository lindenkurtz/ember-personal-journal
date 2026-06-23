import type { Category, FinanceAccount, FinanceTransaction } from '../../../shared/finance/types'

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

export function subscriptionsTotal(txns: FinanceTransaction[]): number {
  return txns
    .filter((t) => t.category === 'subscriptions' && t.amount < 0)
    .reduce((sum, t) => sum + -t.amount, 0)
}

function accountIdsMatching(accounts: FinanceAccount[], ...needles: string[]): Set<string> {
  const ids = new Set<string>()
  for (const a of accounts) {
    const hay = `${a.institution_name ?? ''} ${a.official_name ?? ''} ${a.name}`.toLowerCase()
    if (needles.some((n) => hay.includes(n))) ids.add(a.account_id)
  }
  return ids
}

export interface SavingsRates {
  shortTerm: number // into Brokerage Emergency
  longTerm: number // into Brokerage Savings/Investments
  shortTermRate: number | null
  longTermRate: number | null
}

/**
 * Two separate savings figures — deliberately NOT smoothed. Internship summers
 * vs school months swing hard and that swing is the signal. Inflows are detected
 * as positive-amount transactions landing on the matched savings accounts.
 */
export function savingsRates(txns: FinanceTransaction[], accounts: FinanceAccount[], income: number): SavingsRates {
  // Emergency is matched first; the loop's else-if lets it win when an account
  // name contains both "savings" and "emergency".
  const shortIds = accountIdsMatching(accounts, 'emergency')
  const longIds = accountIdsMatching(accounts, 'investment', 'savings', 'long-term', 'long term')
  let shortTerm = 0
  let longTerm = 0
  for (const t of txns) {
    if (t.amount <= 0 || !t.account_id) continue
    if (shortIds.has(t.account_id)) shortTerm += t.amount
    else if (longIds.has(t.account_id)) longTerm += t.amount
  }
  return {
    shortTerm,
    longTerm,
    shortTermRate: income > 0 ? shortTerm / income : null,
    longTermRate: income > 0 ? longTerm / income : null
  }
}
