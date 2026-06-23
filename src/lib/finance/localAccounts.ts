// Synthetic accounts for sources Plaid can't reach (Apple Card / Apple Cash).
// Both are net-worth-excluded: Apple Card because the user is a participant on
// someone else's account, Apple Cash because there's no connected balance to
// snapshot. Their transactions still feed spending / cash flow.
import type { FinanceAccount } from '../../../shared/finance/types'
import { ensureLocalAccount } from './accounts'

export const APPLE_CARD_ACCOUNT_ID = 'csv-apple-card'
export const APPLE_CASH_ACCOUNT_ID = 'manual-apple-cash'

export const APPLE_CARD_ACCOUNT: FinanceAccount = {
  account_id: APPLE_CARD_ACCOUNT_ID,
  item_id: null,
  name: 'Apple Card',
  official_name: 'Apple Card (manual)',
  institution_name: 'Apple Card',
  type: 'credit',
  subtype: 'credit card',
  mask: null,
  is_asset: false,
  include_in_net_worth: false,
  source: 'csv',
  last_synced_at: null
}

export const APPLE_CASH_ACCOUNT: FinanceAccount = {
  account_id: APPLE_CASH_ACCOUNT_ID,
  item_id: null,
  name: 'Apple Cash',
  official_name: 'Apple Cash (manual)',
  institution_name: 'Apple Cash',
  type: 'depository',
  subtype: 'prepaid',
  mask: null,
  is_asset: true,
  include_in_net_worth: false, // no connected balance to snapshot
  source: 'manual',
  last_synced_at: null
}

export const LOCAL_ACCOUNTS: FinanceAccount[] = [APPLE_CARD_ACCOUNT, APPLE_CASH_ACCOUNT]

export function localAccountById(id: string): FinanceAccount | undefined {
  return LOCAL_ACCOUNTS.find((a) => a.account_id === id)
}

/** Create the synthetic account row if it doesn't exist yet. */
export async function ensureLocal(id: string): Promise<void> {
  const account = localAccountById(id)
  if (account) await ensureLocalAccount(account)
}
