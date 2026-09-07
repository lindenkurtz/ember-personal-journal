// Thin Plaid REST wrapper. We call the HTTP API directly with fetch rather than
// the `plaid` npm SDK because the SDK is axios-based and Node-only — it won't
// run on Cloudflare Workers/Pages (same reason the repo hand-rolls Web Push).

export interface PlaidEnv {
  PLAID_CLIENT_ID: string
  PLAID_SECRET: string
  PLAID_ENV: string // 'sandbox' | 'production'
}

export interface PlaidAccount {
  account_id: string
  name: string
  official_name: string | null
  type: string
  subtype: string | null
  mask: string | null
  balances: {
    current: number | null
    available: number | null
    iso_currency_code: string | null
  }
}

export interface StudentLoan {
  account_id: string
  outstanding_interest_amount: number | null
  // Plaid exposes the current balance on the linked account, not the liability
  // object, so callers join against the accounts array for the balance.
}

export class PlaidError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

function base(env: PlaidEnv): string {
  return `https://${env.PLAID_ENV}.plaid.com`
}

async function plaidPost<T>(env: PlaidEnv, path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(base(env) + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, ...body })
  })
  if (!res.ok) {
    const text = await res.text()
    throw new PlaidError(`plaid ${path} ${res.status}: ${text}`, res.status)
  }
  return (await res.json()) as T
}

export function createLinkToken(env: PlaidEnv, clientUserId: string, redirectUri?: string) {
  return plaidPost<{ link_token: string; expiration: string }>(env, '/link/token/create', {
    client_name: 'Ember',
    language: 'en',
    country_codes: ['US'],
    user: { client_user_id: clientUserId },
    // Transaction ingest was retired (Sept 2026), so a new item only needs
    // Balance. Existing items keep whatever they were linked with — this
    // narrows what future links consent to, it does not re-scope old ones.
    products: ['balance'],
    // Requested opportunistically per-item at sync time and tolerated when an
    // institution doesn't support it.
    optional_products: ['liabilities'],
    ...(redirectUri ? { redirect_uri: redirectUri } : {})
  })
}

export function exchangePublicToken(env: PlaidEnv, publicToken: string) {
  return plaidPost<{ access_token: string; item_id: string }>(env, '/item/public_token/exchange', {
    public_token: publicToken
  })
}

export function getAccounts(env: PlaidEnv, accessToken: string) {
  return plaidPost<{ accounts: PlaidAccount[]; item: { institution_id: string | null } }>(env, '/accounts/get', {
    access_token: accessToken
  })
}

export function getBalances(env: PlaidEnv, accessToken: string) {
  return plaidPost<{ accounts: PlaidAccount[] }>(env, '/accounts/balance/get', {
    access_token: accessToken
  })
}

export function getLiabilities(env: PlaidEnv, accessToken: string) {
  return plaidPost<{
    accounts: PlaidAccount[]
    liabilities: { student?: StudentLoan[] | null } | null
  }>(env, '/liabilities/get', { access_token: accessToken })
}
