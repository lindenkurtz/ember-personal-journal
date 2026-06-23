/*
 * Cloudflare Pages Function — runs a full Plaid sync on demand (the "Sync now"
 * button). Shares the exact orchestration the cron Worker uses, so manual and
 * scheduled syncs can never drift. SUPABASE_SERVICE_KEY is the RLS-bypassing
 * secret key, mapped into the shared runSync's SUPABASE_KEY field.
 */
import { runSync } from '../../../shared/finance/sync'

interface Env {
  PLAID_CLIENT_ID: string
  PLAID_SECRET: string
  PLAID_ENV: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    if (!ctx.env.PLAID_CLIENT_ID) return Response.json({ error: 'plaid_not_configured' }, { status: 200 })
    const summary = await runSync({
      PLAID_CLIENT_ID: ctx.env.PLAID_CLIENT_ID,
      PLAID_SECRET: ctx.env.PLAID_SECRET,
      PLAID_ENV: ctx.env.PLAID_ENV,
      SUPABASE_URL: ctx.env.SUPABASE_URL,
      SUPABASE_KEY: ctx.env.SUPABASE_SERVICE_KEY
    })
    return Response.json({ summary })
  } catch (e) {
    console.error('plaid sync', e)
    return Response.json({ error: 'sync_failed', detail: String(e) }, { status: 200 })
  }
}
