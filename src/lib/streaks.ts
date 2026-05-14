import { Entry } from './entries'
import { lastNDays } from './date'

/**
 * Counts consecutive days ending today where a predicate held.
 * Missing entries break the streak (no row = not logged = not counted).
 * Rest days count as "kept" for gym streaks — that's intentional: a rest day
 * is part of the routine, not a miss.
 */
export function streak(entries: Entry[], pred: (e: Entry) => boolean): number {
  // Index by date for O(1) lookup against the date window.
  const byDate = new Map(entries.map((e) => [e.date, e]))
  const days = lastNDays(60).slice().reverse() // walk back from today
  let n = 0
  for (const d of days) {
    const e = byDate.get(d)
    if (e && pred(e)) n++
    else break
  }
  return n
}

export const gymStreak = (entries: Entry[]) =>
  streak(entries, (e) => e.gym_actual === 'yes' || e.gym_actual === 'rest')

export const deepWorkStreak = (entries: Entry[]) =>
  streak(entries, (e) => (e.deep_work_actual ?? 0) >= (e.deep_work_target ?? Infinity))
