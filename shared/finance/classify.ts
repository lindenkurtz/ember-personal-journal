import type { Category, FinanceAccount, SavingsBucket } from './types'
import { mapPlaidCategory, isSubscriptionMerchant } from './categories'

export interface ClassifyInput {
  name: string | null
  merchant_name: string | null
  amount: number // inflow positive, outflow negative
  pfc_primary?: string | null
  pfc_detailed?: string | null
}

export interface ClassifyContext {
  cc_payment_payee: string | null
}

export interface ClassifyResult {
  category: Category
  is_transfer: boolean
  flagged_for_review: boolean
  reviewed: boolean
  notes: string | null
  savings_bucket: SavingsBucket | null
}

/**
 * Detect a savings/retirement contribution by the account the money landed in.
 * Only fires on the destination (inflow) side — the Brokerage account that
 * received the money tells us the bucket. The source-side Bank outflow
 * can't be auto-bucketed (it doesn't name which Brokerage account), so that case
 * is labeled manually in the editor.
 */
export function detectSavingsBucket(account: FinanceAccount | undefined, amount: number): SavingsBucket | null {
  if (!account || amount <= 0) return null
  const hay = `${account.institution_name ?? ''} ${account.official_name ?? ''} ${account.name}`.toLowerCase()
  if (hay.includes('roth') || hay.includes('ira') || hay.includes('retirement')) return 'retirement'
  if (hay.includes('emergency')) return 'short_term'
  if (hay.includes('investment') || hay.includes('brokerage') || hay.includes('savings') || hay.includes('long')) return 'long_term'
  return null
}

function institutionMatches(account: FinanceAccount | undefined, needle: string): boolean {
  if (!account) return false
  const hay = `${account.institution_name ?? ''} ${account.name ?? ''}`.toLowerCase()
  return hay.includes(needle)
}

function textMatches(input: ClassifyInput, needle: string): boolean {
  const hay = `${input.merchant_name ?? ''} ${input.name ?? ''}`.toLowerCase()
  return hay.includes(needle.toLowerCase())
}

/**
 * Layer our business rules on top of Plaid's auto-tagging. Rule order matters:
 * the most specific account/merchant rules win, then Plaid transfer detection,
 * then the generic category map.
 *
 * `reviewed` true means "auto-accepted, stays out of the review queue".
 * Ambiguous peer money is flagged + unreviewed so it surfaces for a decision.
 */
export function classify(
  input: ClassifyInput,
  account: FinanceAccount | undefined,
  ctx: ClassifyContext
): ClassifyResult {
  const isAppleCash = institutionMatches(account, 'apple cash')
  const isVenmo = institutionMatches(account, 'venmo') || textMatches(input, 'venmo')
  const savings = detectSavingsBucket(account, input.amount)

  // Venmo / peer money is almost never a clean expense — always hold for review.
  if (isVenmo) {
    return { category: 'peer_payment', is_transfer: false, flagged_for_review: true, reviewed: false, notes: null, savings_bucket: null }
  }

  // Apple Cash → mom: the weekly Apple Card payoff. A transfer, never an expense.
  if (isAppleCash && input.amount < 0 && ctx.cc_payment_payee && textMatches(input, ctx.cc_payment_payee)) {
    return { category: 'transfer', is_transfer: true, flagged_for_review: false, reviewed: true, notes: 'Credit Card Payment', savings_bucket: null }
  }

  // Apple Cash inflow from Apple Card rewards.
  if (isAppleCash && input.amount > 0 && (textMatches(input, 'daily cash') || textMatches(input, 'apple card') || textMatches(input, 'cash back'))) {
    return { category: 'income', is_transfer: false, flagged_for_review: false, reviewed: true, notes: 'Cash Back', savings_bucket: null }
  }

  // Plaid-tagged transfers between accounts — treat as internal moves. A
  // transfer landing in a savings/retirement account also carries its bucket.
  if (input.pfc_primary === 'TRANSFER_IN' || input.pfc_primary === 'TRANSFER_OUT' || input.pfc_primary === 'LOAN_PAYMENTS') {
    return { category: 'transfer', is_transfer: true, flagged_for_review: false, reviewed: true, notes: null, savings_bucket: savings }
  }

  if (isSubscriptionMerchant(input.name, input.merchant_name)) {
    return { category: 'subscriptions', is_transfer: false, flagged_for_review: false, reviewed: true, notes: null, savings_bucket: null }
  }

  const category = mapPlaidCategory(input.pfc_primary, input.pfc_detailed)
  return { category, is_transfer: false, flagged_for_review: false, reviewed: true, notes: null, savings_bucket: savings }
}
