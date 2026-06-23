/*
 * Client wrappers for the Plaid Pages Functions at /api/plaid/*. Mirrors the
 * callClaude pattern in src/lib/claude.ts — the browser never sees Plaid creds,
 * only the short-lived link_token and sync summaries.
 */
import type { SyncSummary } from '../../../shared/finance/types'

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!r.ok) throw new Error(`${path} ${r.status}: ${await r.text()}`)
  const json = (await r.json()) as T & { error?: string; detail?: string }
  if (json.error) throw new Error(`${json.error}: ${json.detail ?? ''}`)
  return json
}

export async function createPlaidLinkToken(redirectUri?: string): Promise<string> {
  const body = await postJson<{ link_token?: string }>('/api/plaid/link-token', { redirect_uri: redirectUri })
  return body.link_token ?? ''
}

export async function exchangePublicToken(publicToken: string, institutionName?: string): Promise<void> {
  await postJson('/api/plaid/exchange', { public_token: publicToken, institution_name: institutionName })
}

export async function runPlaidSync(): Promise<SyncSummary> {
  const body = await postJson<{ summary: SyncSummary }>('/api/plaid/sync')
  return body.summary
}
