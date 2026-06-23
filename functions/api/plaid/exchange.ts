/*
 * Cloudflare Pages Function — exchanges a Plaid public_token for an access
 * token, persists the Item (server-only table), and seeds account metadata.
 * The Apple Card / any credit account is seeded with include_in_net_worth=false.
 */
import { createClient } from '@supabase/supabase-js'
import { exchangePublicToken, getAccounts } from '../../../shared/finance/plaidApi'

interface Env {
  PLAID_CLIENT_ID: string
  PLAID_SECRET: string
  PLAID_ENV: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_KEY: string
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const body = await ctx.request.json<{ public_token?: string; institution_name?: string }>()
    if (!body?.public_token) return Response.json({ error: 'missing_public_token' }, { status: 200 })

    const plaidEnv = { PLAID_CLIENT_ID: ctx.env.PLAID_CLIENT_ID, PLAID_SECRET: ctx.env.PLAID_SECRET, PLAID_ENV: ctx.env.PLAID_ENV }
    const { access_token, item_id } = await exchangePublicToken(plaidEnv, body.public_token)

    const supabase = createClient(ctx.env.SUPABASE_URL, ctx.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

    await supabase.from('finance_plaid_items').upsert(
      {
        item_id,
        access_token,
        institution_name: body.institution_name ?? null,
        products: ['transactions', 'balance'],
        status: 'active'
      },
      { onConflict: 'item_id' }
    )

    const { accounts } = await getAccounts(plaidEnv, access_token)
    const rows = accounts.map((a) => {
      const isAsset = a.type !== 'credit' && a.type !== 'loan'
      return {
        account_id: a.account_id,
        item_id,
        name: a.name,
        official_name: a.official_name,
        institution_name: body.institution_name ?? null,
        type: a.type,
        subtype: a.subtype,
        mask: a.mask,
        is_asset: isAsset,
        include_in_net_worth: isAsset,
        source: 'plaid'
      }
    })
    if (rows.length) {
      // Don't overwrite an existing row's user toggles on a re-link.
      await supabase.from('finance_accounts').upsert(rows, { onConflict: 'account_id', ignoreDuplicates: true })
    }

    return Response.json({ item_id, accounts: rows.length })
  } catch (e) {
    console.error('plaid exchange', e)
    return Response.json({ error: 'exchange_failed', detail: String(e) }, { status: 200 })
  }
}
