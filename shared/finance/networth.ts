import type { FinanceAccount } from './types'

export interface NetWorthResult {
  net_worth: number
  assets_total: number
  liabilities_total: number
}

/**
 * Net Worth = Σ(included asset balances) − Σ(liabilities).
 * Any account with include_in_net_worth=false is excluded.
 * Liabilities come from finance_loan_balances, not from accounts.
 */
export function computeNetWorth(
  accounts: FinanceAccount[],
  latestBalanceByAccount: Map<string, number>,
  liabilityTotal: number
): NetWorthResult {
  let assets_total = 0
  for (const acct of accounts) {
    if (!acct.include_in_net_worth || !acct.is_asset) continue
    assets_total += latestBalanceByAccount.get(acct.account_id) ?? 0
  }
  const liabilities_total = liabilityTotal
  return {
    assets_total,
    liabilities_total,
    net_worth: assets_total - liabilities_total
  }
}
