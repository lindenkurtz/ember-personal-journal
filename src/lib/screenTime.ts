import { supabase } from './supabase'
import { addDaysKey, sundayWeekStartKey } from './date'

/**
 * One day of self-reported screen time, entered in weekly batches on
 * /screentime from iOS Settings > Screen Time. Phone and computer are tracked
 * separately on purpose: Instagram is blocked on the phone and the scrolling
 * moved to the Mac — a merged total would show a fake downward trend.
 */
export interface ScreenTimeRow {
  date: string // YYYY-MM-DD, primary key
  phone_minutes: number | null // iPhone, total screen time
  phone_pickups: number | null // iPhone
  computer_minutes: number | null // Mac + iPad combined
}

const COLUMNS = 'date, phone_minutes, phone_pickups, computer_minutes'

/** Rows between `start` and `end` inclusive (oldest first). Missing days are omitted. */
export async function getScreenTimeRange(start: string, end: string): Promise<ScreenTimeRow[]> {
  const { data, error } = await supabase
    .from('screen_time')
    .select(COLUMNS)
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: true })
  if (error) throw error
  return (data ?? []) as ScreenTimeRow[]
}

/** All rows ever recorded (oldest first). Used by History and the Patterns prompt. */
export async function getAllScreenTime(): Promise<ScreenTimeRow[]> {
  const { data, error } = await supabase
    .from('screen_time')
    .select(COLUMNS)
    .order('date', { ascending: true })
  if (error) throw error
  return (data ?? []) as ScreenTimeRow[]
}

/**
 * Upsert a batch of day rows. Callers must only pass days with at least one
 * non-null value — an all-blank day is skipped at the form layer, never
 * written, so sparse weeks stay sparse.
 */
export async function upsertScreenTimeDays(rows: ScreenTimeRow[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabase
    .from('screen_time')
    .upsert(rows, { onConflict: 'date' })
    .select()
  if (error) throw error
}

/** Total minutes -> "2h 31m" to match how iOS Settings > Screen Time displays it. */
export function formatDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
  const m = Math.round(totalMinutes % 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export interface PhoneTimeTrend {
  weekStart: string
  weekEnd: string
  lastWeekAvgMinutes: number
  overallAvgMinutes: number
  /** Signed percent change of the last logged week vs. the all-week average. */
  pctChange: number
  /** How many Sun–Sat weeks have at least one phone_minutes value — gates showing pctChange. */
  weeksLogged: number
}

/**
 * Compares the most recently logged Sun–Sat week's average daily phone
 * minutes against the average across all logged weeks. Weeks are weighted
 * equally regardless of how many days within them were filled in — matching
 * the "week logged" convention used elsewhere (a 1-day partial week counts
 * the same as a full 7-day week), so a sparse week doesn't get diluted or
 * inflated relative to a complete one.
 */
export function phoneTimeTrend(rows: ScreenTimeRow[]): PhoneTimeTrend | null {
  const byWeek = new Map<string, number[]>()
  for (const r of rows) {
    if (r.phone_minutes == null) continue
    const wk = sundayWeekStartKey(r.date)
    const bucket = byWeek.get(wk)
    if (bucket) bucket.push(r.phone_minutes)
    else byWeek.set(wk, [r.phone_minutes])
  }
  if (byWeek.size === 0) return null

  const weekAverages = Array.from(byWeek.entries())
    .map(([weekStart, mins]) => ({
      weekStart,
      avg: mins.reduce((a, b) => a + b, 0) / mins.length
    }))
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))

  const last = weekAverages[weekAverages.length - 1]
  const overallAvg = weekAverages.reduce((sum, w) => sum + w.avg, 0) / weekAverages.length

  return {
    weekStart: last.weekStart,
    weekEnd: addDaysKey(last.weekStart, 6),
    lastWeekAvgMinutes: last.avg,
    overallAvgMinutes: overallAvg,
    pctChange: overallAvg === 0 ? 0 : ((last.avg - overallAvg) / overallAvg) * 100,
    weeksLogged: weekAverages.length
  }
}
