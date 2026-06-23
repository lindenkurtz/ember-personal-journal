import type { Category } from './types'

// Display order is the order shown in the editor dropdown and breakdowns.
// Subscriptions sits next to its spending neighbours but is always surfaced as
// its own line item in the UI regardless of position here.
export const CATEGORIES: Category[] = [
  'income',
  'transfer',
  'housing',
  'groceries',
  'dining',
  'subscriptions',
  'health',
  'transportation',
  'school_work',
  'shopping',
  'peer_payment'
]

export const CATEGORY_LABELS: Record<Category, string> = {
  income: 'Income',
  transfer: 'Transfer',
  housing: 'Housing',
  groceries: 'Groceries',
  dining: 'Dining & Coffee',
  subscriptions: 'Subscriptions',
  health: 'Health & Fitness',
  transportation: 'Transportation',
  school_work: 'School & Work',
  shopping: 'Shopping',
  peer_payment: 'Peer Payment'
}

// Categories excluded from income/expense cash-flow math. `transfer` is the
// internal-move bucket; `peer_payment` is held out until the user resolves it
// in the review queue.
export const NON_SPENDING: Category[] = ['transfer', 'income']

// Map Plaid's personal_finance_category.primary → our simplified schema. The
// detailed override below catches the few primaries we want to split further.
const PFC_PRIMARY_MAP: Record<string, Category> = {
  INCOME: 'income',
  TRANSFER_IN: 'transfer',
  TRANSFER_OUT: 'transfer',
  LOAN_PAYMENTS: 'transfer',
  BANK_FEES: 'shopping',
  ENTERTAINMENT: 'shopping',
  FOOD_AND_DRINK: 'dining',
  GENERAL_MERCHANDISE: 'shopping',
  HOME_IMPROVEMENT: 'housing',
  MEDICAL: 'health',
  PERSONAL_CARE: 'health',
  GENERAL_SERVICES: 'shopping',
  GOVERNMENT_AND_NON_PROFIT: 'shopping',
  TRANSPORTATION: 'transportation',
  TRAVEL: 'transportation',
  RENT_AND_UTILITIES: 'housing'
}

// Plaid lumps groceries under FOOD_AND_DRINK; the detailed field separates them.
const PFC_DETAILED_MAP: Record<string, Category> = {
  FOOD_AND_DRINK_GROCERIES: 'groceries',
  GENERAL_SERVICES_EDUCATION: 'school_work',
  PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS: 'health'
}

// Lowercased merchant substrings we auto-tag as subscriptions. The review queue
// + manual editing cover anything this misses — better to under-claim here.
const SUBSCRIPTION_MERCHANTS = [
  'netflix', 'spotify', 'apple.com/bill', 'hulu', 'disney', 'youtube premium',
  'icloud', 'patreon', 'notion', 'github', 'openai', 'anthropic', 'adobe',
  'amazon prime', 'hbo', 'max', 'chatgpt', 'dropbox'
]

export function isSubscriptionMerchant(name: string | null, merchant: string | null): boolean {
  const hay = `${merchant ?? ''} ${name ?? ''}`.toLowerCase()
  return SUBSCRIPTION_MERCHANTS.some((m) => hay.includes(m))
}

export function mapPlaidCategory(primary?: string | null, detailed?: string | null): Category {
  if (detailed && PFC_DETAILED_MAP[detailed]) return PFC_DETAILED_MAP[detailed]
  if (primary && PFC_PRIMARY_MAP[primary]) return PFC_PRIMARY_MAP[primary]
  return 'shopping'
}
