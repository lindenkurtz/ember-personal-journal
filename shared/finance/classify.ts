import type { Category, FinanceAccount, FinanceRule, SavingsBucket } from './types'
import { mapPlaidCategory, isSubscriptionMerchant } from './categories'

export interface ClassifyInput {
  name: string | null
  merchant_name: string | null
  amount: number // inflow positive, outflow negative
  pfc_primary?: string | null
  pfc_detailed?: string | null
}

export interface ClassifyContext {
  rules: FinanceRule[]
}

export interface ClassifyResult {
  category: Category
  is_transfer: boolean
  flagged_for_review: boolean
  reviewed: boolean
  notes: string | null
  savings_bucket: SavingsBucket | null
  income_source: string | null
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
  // Long-term: brokerage/investment vehicles, including UTMA/custodial accounts.
  if (
    hay.includes('investment') || hay.includes('brokerage') || hay.includes('savings') || hay.includes('long') ||
    hay.includes('utma') || hay.includes('uniform transfers') || hay.includes('custodial') || hay.includes('minor')
  ) return 'long_term'
  return null
}

/**
 * Brokerage transfers clear through Clearing Bank, and the destination Brokerage
 * sub-account is named only by its masked Clearing account number in the memo
 * (e.g. "CLEARING BANK CHK XXXXXX1234"). That number is the single thing telling an
 * Emergency from a Roth from a brokerage transfer, so it's the natural key for
 * an auto-learned savings-bucket rule. Pending transfers carry a truncated memo
 * without it — return null then and let the transfer bucket once it posts.
 */
export function brokerageDestToken(name: string | null, merchant: string | null): string | null {
  const hay = `${merchant ?? ''} ${name ?? ''}`.toLowerCase()
  if (!hay.includes('brokerage') && !hay.includes('brokerage inc')) return null
  const m = hay.match(/x{4,}\d{3,}/)
  return m ? m[0] : null
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

// A transfer headed into a Brokerage account. We can detect it by description
// even when the destination Brokerage account isn't connected (investment/Roth
// transactions often don't sync), but the description alone can't say which
// bucket — so we surface these for a one-time manual bucketing in the editor.
function isBrokerageBound(input: ClassifyInput): boolean {
  const hay = `${input.merchant_name ?? ''} ${input.name ?? ''}`.toLowerCase()
  return hay.includes('brokerage') || hay.includes('brokerage inc')
}

/**
 * First user-defined rule whose `match_text` is a substring of the
 * transaction's merchant/name. Shared by the Plaid path (classify) and the
 * screenshot-import path (extract) so both honour the same rules.
 */
export function matchRule(merchant: string | null, name: string | null, rules: FinanceRule[]): FinanceRule | null {
  const hay = `${merchant ?? ''} ${name ?? ''}`.toLowerCase()
  for (const r of rules) {
    if (r.match_text && hay.includes(r.match_text.toLowerCase())) return r
  }
  return null
}

export function ruleResult(rule: FinanceRule): ClassifyResult {
  const isTransfer = rule.category === 'transfer'
  return {
    category: rule.category,
    is_transfer: isTransfer,
    flagged_for_review: false,
    reviewed: true,
    notes: rule.note,
    savings_bucket: rule.savings_bucket,
    income_source: rule.income_source
  }
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
  // User-defined rules win over everything else.
  const rule = matchRule(input.merchant_name, input.name, ctx.rules)
  if (rule) return ruleResult(rule)

  const isAppleCash = institutionMatches(account, 'apple cash')
  const isVenmo = institutionMatches(account, 'venmo') || textMatches(input, 'venmo')
  const savings = detectSavingsBucket(account, input.amount)

  // Venmo / peer money: categorize as a peer payment but don't force review —
  // most of these need no action. Use a rule to auto-handle recurring ones.
  if (isVenmo) {
    return { category: 'peer_payment', is_transfer: false, flagged_for_review: false, reviewed: true, notes: null, savings_bucket: null, income_source: null }
  }

  // Apple Cash inflow from Apple Card rewards.
  if (isAppleCash && input.amount > 0 && (textMatches(input, 'daily cash') || textMatches(input, 'apple card') || textMatches(input, 'cash back'))) {
    return { category: 'income', is_transfer: false, flagged_for_review: false, reviewed: true, notes: 'Cash Back', savings_bucket: null, income_source: null }
  }

  // Plaid-tagged transfers between accounts — treat as internal moves. A
  // transfer landing in a savings/retirement account also carries its bucket.
  if (input.pfc_primary === 'TRANSFER_IN' || input.pfc_primary === 'TRANSFER_OUT' || input.pfc_primary === 'LOAN_PAYMENTS') {
    // Outflow to Brokerage with no auto-detected bucket: surface for manual bucketing.
    const needsBucket = !savings && input.amount < 0 && isBrokerageBound(input)
    return {
      category: 'transfer',
      is_transfer: true,
      flagged_for_review: needsBucket,
      reviewed: !needsBucket,
      notes: needsBucket ? 'Set savings bucket' : null,
      savings_bucket: savings,
      income_source: null
    }
  }

  // Brokerage-bound outflow Plaid didn't tag as a transfer — still a savings
  // move; flag it so the bucket gets set once in the editor (see savingsRates).
  if (input.amount < 0 && isBrokerageBound(input)) {
    return { category: 'transfer', is_transfer: true, flagged_for_review: true, reviewed: false, notes: 'Set savings bucket', savings_bucket: null, income_source: null }
  }

  if (isSubscriptionMerchant(input.name, input.merchant_name)) {
    return { category: 'subscriptions', is_transfer: false, flagged_for_review: false, reviewed: true, notes: null, savings_bucket: null, income_source: null }
  }

  const category = mapPlaidCategory(input.pfc_primary, input.pfc_detailed)
  return { category, is_transfer: false, flagged_for_review: false, reviewed: true, notes: null, savings_bucket: savings, income_source: null }
}
