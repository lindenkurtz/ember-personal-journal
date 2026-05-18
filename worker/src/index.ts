import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { sendPush, PushSubscription, VapidKeys } from './webpush'

export interface Env {
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string
  SUPABASE_URL: string
  SUPABASE_KEY: string
}

type Slot = 'morning' | 'evening'

interface Settings {
  enabled: boolean
  morning_time: string
  evening_time: string
  timezone: string
  last_morning_sent: string | null
  last_evening_sent: string | null
  latitude: number | null
  longitude: number | null
}

interface Entry {
  date: string
  bedtime: string | null
  sleep_quality: number | null
  gym_actual: string | null
  deep_work_actual: number | null
  weather_temp_f: number | null
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(tick(env))
  },
  // Manual trigger for testing: `curl https://<worker>/?force=morning`
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const force = url.searchParams.get('force') as Slot | null
    try {
      await tick(env, force)
      return new Response('ok', { status: 200 })
    } catch (err) {
      console.error('[notifier] error', err)
      return new Response(String(err), { status: 500 })
    }
  }
}

async function tick(env: Env, force?: Slot | null): Promise<void> {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_KEY, {
    auth: { persistSession: false }
  })

  const { data: settingsRow, error: settingsErr } = await supabase
    .from('push_settings')
    .select('enabled, morning_time, evening_time, timezone, last_morning_sent, last_evening_sent, latitude, longitude')
    .eq('id', 1)
    .maybeSingle()
  if (settingsErr) throw settingsErr
  const settings = (settingsRow as Settings | null)
  if (!settings || !settings.enabled) return

  const { dateKey, hhmm } = localNow(settings.timezone)

  const todayEntry = await getEntry(supabase, dateKey)

  // Passive weather snapshot — runs once per local day when we have coords,
  // independent of push send. The dedupe guard means Open-Meteo is hit at
  // most once per day regardless of how many 5-min ticks happen, and it
  // works even when no push subscriptions exist or the morning push is
  // skipped because the check-in is already filled.
  if (
    settings.latitude != null &&
    settings.longitude != null &&
    (todayEntry == null || todayEntry.weather_temp_f == null)
  ) {
    await fetchAndStoreWeather(supabase, settings.latitude, settings.longitude, dateKey)
  }

  if (force === 'morning' || dueMorning(settings, hhmm, dateKey, todayEntry)) {
    await fire(supabase, env, 'morning', dateKey)
  }
  if (force === 'evening' || dueEvening(settings, hhmm, dateKey, todayEntry)) {
    await fire(supabase, env, 'evening', dateKey)
  }
}

function dueMorning(s: Settings, hhmm: string, dateKey: string, e: Entry | null): boolean {
  if (s.last_morning_sent === dateKey) return false
  if (hhmm < s.morning_time) return false
  // Morning check-in is "done" when bedtime and sleep quality are present.
  return !(e && e.bedtime && e.sleep_quality !== null)
}

function dueEvening(s: Settings, hhmm: string, dateKey: string, e: Entry | null): boolean {
  if (s.last_evening_sent === dateKey) return false
  if (hhmm < s.evening_time) return false
  return !(e && e.deep_work_actual !== null && e.gym_actual !== null)
}

async function getEntry(supabase: SupabaseClient, date: string): Promise<Entry | null> {
  const { data, error } = await supabase
    .from('entries')
    .select('date, bedtime, sleep_quality, gym_actual, deep_work_actual, weather_temp_f')
    .eq('date', date)
    .maybeSingle()
  if (error) throw error
  return (data as Entry | null) ?? null
}

async function fire(supabase: SupabaseClient, env: Env, slot: Slot, dateKey: string): Promise<void> {
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
  if (error) throw error
  const list = (subs ?? []) as PushSubscription[]
  if (list.length === 0) {
    console.log(`[notifier] ${slot}: no subscriptions`)
    return
  }

  const vapid: VapidKeys = {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT
  }
  const payload = JSON.stringify(payloadFor(slot))

  const results = await Promise.allSettled(
    list.map((sub) => sendPush(sub, payload, vapid).then((r) => ({ sub, r })))
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[notifier] send failed', result.reason)
      continue
    }
    const { sub, r } = result.value
    if (r.status === 404 || r.status === 410) {
      console.log(`[notifier] pruning expired subscription ${sub.endpoint}`)
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    } else if (r.status >= 400) {
      console.error(`[notifier] ${r.status} from push service`, await r.text())
    }
  }

  // Mark this slot sent for today so subsequent ticks don't re-fire.
  const column = slot === 'morning' ? 'last_morning_sent' : 'last_evening_sent'
  await supabase.from('push_settings').update({ [column]: dateKey }).eq('id', 1)
}

async function fetchAndStoreWeather(
  supabase: SupabaseClient,
  lat: number,
  lon: number,
  dateKey: string
): Promise<void> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode&temperature_unit=fahrenheit`
    const res = await fetch(url)
    if (!res.ok) {
      console.error('[notifier] open-meteo', res.status)
      return
    }
    const json = (await res.json()) as {
      current?: { temperature_2m?: number; weathercode?: number }
    }
    const t = json.current?.temperature_2m
    const c = json.current?.weathercode
    if (t == null && c == null) return
    const { error } = await supabase
      .from('entries')
      .upsert(
        { date: dateKey, weather_temp_f: t ?? null, weather_code: c ?? null },
        { onConflict: 'date' }
      )
    if (error) console.error('[notifier] weather upsert', error)
  } catch (err) {
    console.error('[notifier] weather fetch failed', err)
  }
}

function payloadFor(slot: Slot): { title: string; body: string; tag: Slot; url: string } {
  if (slot === 'morning') {
    return {
      title: 'Morning check-in',
      body: 'How did you sleep?',
      tag: 'morning',
      url: '/morning'
    }
  }
  return {
    title: 'Evening check-in',
    body: 'How did the day go?',
    tag: 'evening',
    url: '/evening'
  }
}

// Compute current date and HH:MM in the user's IANA timezone. Intl handles
// DST automatically — that's the whole reason we don't bake the offset into
// the cron expression.
function localNow(timeZone: string): { dateKey: string; hhmm: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
  const parts = fmt.formatToParts(new Date())
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? ''
  // en-CA emits hour as '24' at midnight on some runtimes — normalize.
  const hourRaw = get('hour')
  const hour = hourRaw === '24' ? '00' : hourRaw
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    hhmm: `${hour}:${get('minute')}`
  }
}
