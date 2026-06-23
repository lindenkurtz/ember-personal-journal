import type { Category, FinanceAccount } from './types'
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

  // Venmo / peer money is almost never a clean expense — always hold for review.
  if (isVenmo) {
    return { category: 'peer_payment', is_transfer: false, flagged_for_review: true, reviewed: false, notes: null }
  }

  // Apple Cash → mom: the weekly Apple Card payoff. A transfer, never an expense.
  if (isAppleCash && input.amount < 0 && ctx.cc_payment_payee && textMatches(input, ctx.cc_payment_payee)) {
    return { category: 'transfer', is_transfer: true, flagged_for_review: false, reviewed: true, notes: 'Credit Card Payment' }
  }

  // Apple Cash inflow from Apple Card rewards.
  if (isAppleCash && input.amount > 0 && (textMatches(input, 'daily cash') || textMatches(input, 'apple card') || textMatches(input, 'cash back'))) {
    return { category: 'income', is_transfer: false, flagged_for_review: false, reviewed: true, notes: 'Cash Back' }
  }

  // Plaid-tagged transfers between accounts — treat as internal moves.
  if (input.pfc_primary === 'TRANSFER_IN' || input.pfc_primary === 'TRANSFER_OUT' || input.pfc_primary === 'LOAN_PAYMENTS') {
    return { category: 'transfer', is_transfer: true, flagged_for_review: false, reviewed: true, notes: null }
  }

  if (isSubscriptionMerchant(input.name, input.merchant_name)) {
    return { category: 'subscriptions', is_transfer: false, flagged_for_review: false, reviewed: true, notes: null }
  }

  const category = mapPlaidCategory(input.pfc_primary, input.pfc_detailed)
  return { category, is_transfer: false, flagged_for_review: false, reviewed: true, notes: null }
}
