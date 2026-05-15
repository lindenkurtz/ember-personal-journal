import { supabase } from './supabase'
import { todayKey, lastNDays } from './date'

export type GymChoice = 'yes' | 'no'

/** Shape of a single daily entry. One row per date. */
export interface Entry {
  date: string // YYYY-MM-DD, primary key
  bedtime: string | null // 'HH:MM' last night
  sleep_quality: number | null // 1–5
  gym_intention: GymChoice | null
  gym_actual: GymChoice | null
  deep_work_target: number | null // hours
  deep_work_actual: number | null
  deep_work_start: string | null // 'HH:MM'
  social: boolean | null
  note: string | null
}

/** Partial entry used by morning/evening upserts. `date` is required. */
export type EntryPatch = Partial<Entry> & { date: string }

export async function getEntry(date: string = todayKey()): Promise<Entry | null> {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('date', date)
    .maybeSingle()
  if (error) throw error
  return (data as Entry | null) ?? null
}

/**
 * Upsert by primary key `date`. Morning fills the intent columns; evening
 * fills the actuals — both calls hit the same row, never duplicate.
 */
export async function upsertEntry(patch: EntryPatch): Promise<Entry> {
  const { data, error } = await supabase
    .from('entries')
    .upsert(patch, { onConflict: 'date' })
    .select()
    .single()
  if (error) throw error
  return data as Entry
}

/** Fetch the last `n` days of entries (oldest first). Missing days are omitted. */
export async function getRange(n: number): Promise<Entry[]> {
  const keys = lastNDays(n)
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .gte('date', keys[0])
    .lte('date', keys[keys.length - 1])
    .order('date', { ascending: true })
  if (error) throw error
  return (data ?? []) as Entry[]
}
