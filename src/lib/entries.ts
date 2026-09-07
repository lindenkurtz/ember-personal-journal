import { supabase } from './supabase'
import { todayKey, lastNDays } from './date'

export type GymChoice = 'yes' | 'no'

export type FocusedWork = 'none' | 'light' | 'solid' | 'deep'

/** Ordinal replacement for the `social` boolean, which carries too little
 * resolution to separate days. */
export type SocialLevel = 0 | 1 | 2 | 3

/** Ordinal replacement for the `sick` boolean. Not a severity axis: 1 and 2 are
 * different kinds of day that happen to be ordered by impact, so they are read as
 * separate categories — never summed, averaged, or treated as one scale. */
export type SickLevel = 0 | 1 | 2

/** The six confound flags captured in the evening flow. On historical rows all
 * six are null = "untracked"; from TRACKING_V2_START the evening save writes
 * explicit true/false for every flag. Preserve that distinction in any new
 * write path. */
export const CONFOUND_KEYS = [
  'sick',
  'alcohol',
  'slept_away',
  'travel_day',
  'caffeine_late',
  'deadline_pressure'
] as const
export type ConfoundKey = (typeof CONFOUND_KEYS)[number]

/** Short display labels shared by the evening step and History badges. */
export const CONFOUND_LABELS: Record<ConfoundKey, string> = {
  sick: 'Sick',
  alcohol: 'Alcohol',
  slept_away: 'Slept away',
  travel_day: 'Travel day',
  caffeine_late: 'Late caffeine',
  deadline_pressure: 'Deadline'
}

/** First date the evening flow asks the tracking-v2 questions (meal time +
 * confounds). Gates both the steps and the save payload so re-editing an
 * older day via /evening?date= can never stamp explicit `false` confounds
 * onto rows from before they were tracked. */
export const TRACKING_V2_START = '2026-07-21'

/** focused_work is hidden from the evening flow until the school year starts. */
export const FOCUSED_WORK_START = '2026-08-15'

/** First date the evening flow asks social as a 0–3 level instead of yes/no.
 * Earlier days keep the boolean question: they were never rated at this
 * resolution, and a make-up entry must not invent a level for them. */
export const SOCIAL_LEVEL_START = '2026-09-06'

/** First date the evening flow asks sickness as a 0-2 level instead of one chip.
 * Earlier days keep the bare `sick` boolean: they were never recorded at this
 * resolution, and a make-up entry must not invent a level for one. */
export const SICK_LEVEL_START = '2026-09-06'

/** Shape of a single daily entry. One row per date. */
export interface Entry {
  date: string // YYYY-MM-DD, primary key
  bedtime: string | null // 'HH:MM' last night
  wake_time: string | null // 'HH:MM' this morning
  sleep_quality: number | null // 1–5
  // sleep_hours: RETIRED. The Apple Watch duration the iOS Shortcut was meant to
  // write; it only ever landed on 4 days in May 2026. The column and those rows
  // stay in the DB (same rule as deep_work_* and computer_minutes), but nothing
  // reads, renders, or exports it — so there is no objective sleep measure.
  day_quality: number | null // 1–5, evening self-report of the day overall
  gym_intention: GymChoice | null
  gym_actual: GymChoice | null
  deep_work_target: number | null // hours (legacy, no longer written)
  deep_work_actual: number | null // hours (legacy, no longer written — retired July 2026)
  deep_work_start: string | null // 'HH:MM' (legacy, no longer written)
  deep_work_planned: 'yes' | 'no' | null // legacy, no longer written — retired July 2026
  deep_work_plan_note: string | null // legacy, no longer written — retired July 2026
  focused_work: FocusedWork | null // replaces deep work for the school year, asked from FOCUSED_WORK_START
  last_meal_start_time: string | null // 'HH:MM' — when the last meal of the day STARTED
  sick: boolean | null // from SICK_LEVEL_START written as (sick_level >= 2), so it keeps meaning a major day
  sick_level: SickLevel | null // 0 none / 1 light / 2 major, asked from SICK_LEVEL_START
  alcohol: boolean | null
  slept_away: boolean | null // the night ending this morning (same row-date semantics as sleep fields)
  travel_day: boolean | null // 3+ hours in transit today
  caffeine_late: boolean | null // caffeine after ~2pm today
  deadline_pressure: boolean | null // exam or major deadline within 48h
  social: boolean | null // legacy binary; still written from SOCIAL_LEVEL_START as (social_level > 0) so the series stays continuous
  social_level: SocialLevel | null // 0 none / 1 passing / 2 a real hang / 3 most of the day, asked from SOCIAL_LEVEL_START
  note: string | null
  hrv_avg: number | null
  resting_hr: number | null
  steps: number | null
  weather_temp_f: number | null
  weather_code: number | null
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

/** Fetch all entries ever recorded (oldest first). Used for all-time best-streak calculation. */
export async function getAllEntries(): Promise<Entry[]> {
  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .order('date', { ascending: true })
  if (error) throw error
  return (data ?? []) as Entry[]
}
