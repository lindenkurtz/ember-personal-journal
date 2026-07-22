import { supabase } from './supabase'

/**
 * A life-context phase (summer, semester, break…) used to group entries in
 * analysis. `end_date` null = currently active. Overlaps are impossible at the
 * DB level — a gist EXCLUDE constraint with inclusive bounds — so adjacent
 * periods must not share a day: a new period starts the day AFTER the previous
 * one's end_date.
 */
export interface ContextPeriod {
  id: number
  label: string
  start_date: string // YYYY-MM-DD
  end_date: string | null // YYYY-MM-DD, null = active
}

const COLUMNS = 'id, label, start_date, end_date'

export async function listContextPeriods(): Promise<ContextPeriod[]> {
  const { data, error } = await supabase
    .from('context_periods')
    .select(COLUMNS)
    .order('start_date', { ascending: true })
  if (error) throw error
  return (data ?? []) as ContextPeriod[]
}

export async function createContextPeriod(
  p: Omit<ContextPeriod, 'id'>
): Promise<ContextPeriod> {
  const { data, error } = await supabase
    .from('context_periods')
    .insert(p)
    .select(COLUMNS)
    .single()
  if (error) throw friendly(error)
  return data as ContextPeriod
}

export async function updateContextPeriod(
  id: number,
  patch: Partial<Omit<ContextPeriod, 'id'>>
): Promise<ContextPeriod> {
  const { data, error } = await supabase
    .from('context_periods')
    .update(patch)
    .eq('id', id)
    .select(COLUMNS)
    .single()
  if (error) throw friendly(error)
  return data as ContextPeriod
}

export async function deleteContextPeriod(id: number): Promise<void> {
  const { error } = await supabase.from('context_periods').delete().eq('id', id)
  if (error) throw error
}

/** The period a date falls in, or null. Plain ISO string comparison. */
export function periodForDate(
  periods: ContextPeriod[],
  dateKey: string
): ContextPeriod | null {
  for (const p of periods) {
    if (p.start_date <= dateKey && (p.end_date === null || dateKey <= p.end_date)) return p
  }
  return null
}

// 23P01 = exclusion_violation from the no-overlap constraint; 23505 = the
// unique label. Both are user-fixable input problems, so translate them.
function friendly(error: { code?: string; message: string }): Error {
  if (error.code === '23P01') {
    return new Error('Overlaps an existing period — periods must not share any day.')
  }
  if (error.code === '23505') {
    return new Error('A period with that label already exists.')
  }
  return new Error(error.message)
}
