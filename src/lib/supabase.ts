import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anon) {
  // Fail loudly in dev — silent failure here would make the check-in look
  // like it was working while never persisting anything.
  console.warn(
    '[ember] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Entries will not persist.'
  )
}

export const supabase = createClient(url ?? '', anon ?? '', {
  auth: { persistSession: false } // Cloudflare Access handles auth — no Supabase session needed.
})
