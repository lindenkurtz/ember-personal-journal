import { supabase } from './supabase'

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
