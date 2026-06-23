/*
 * Cloudflare Pages Function — creates a short-lived Plaid Link token.
 * Plaid client_id/secret stay server-side; the browser only ever receives the
 * link_token, which Plaid Link exchanges for a public_token.
 */
import { createLinkToken } from '../../../shared/finance/plaidApi'

interface Env {
  PLAID_CLIENT_ID: string
  PLAID_SECRET: string
  PLAID_ENV: string
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    if (!ctx.env.PLAID_CLIENT_ID || !ctx.env.PLAID_SECRET) {
      return Response.json({ error: 'plaid_not_configured' }, { status: 200 })
    }
    let body: { redirect_uri?: string } = {}
    try {
      body = await ctx.request.json()
    } catch {
      // No body is fine — redirect_uri is optional (only OAuth banks need it).
    }
    const env = { PLAID_CLIENT_ID: ctx.env.PLAID_CLIENT_ID, PLAID_SECRET: ctx.env.PLAID_SECRET, PLAID_ENV: ctx.env.PLAID_ENV }
    const out = await createLinkToken(env, 'ember-single-user', body.redirect_uri)
    return Response.json({ link_token: out.link_token })
  } catch (e) {
    console.error('plaid link-token', e)
    return Response.json({ error: 'link_token_failed', detail: String(e) }, { status: 200 })
  }
}
