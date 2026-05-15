import { Entry } from './entries'
import { lastNDays, todayKey, weekStartKey } from './date'

/**
 * Counts consecutive days ending today where a predicate held.
 * Missing entries break the streak (no row = not logged = not counted).
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

/**
 * Gym streak with a weekly rest budget. A 'no' day is "kept" only if the
 * total 'no' count within its calendar week (Mon–Sun) is at most `restBudget`.
 * Once a week's 'no' count exceeds budget, every 'no' day in that week breaks
 * the streak; 'yes' days in a blown week still count.
 */
export function gymStreak(entries: Entry[], restBudget: number): number {
  const noByWeek = new Map<string, number>()
  for (const e of entries) {
    if (e.gym_actual === 'no') {
      const wk = weekStartKey(e.date)
      noByWeek.set(wk, (noByWeek.get(wk) ?? 0) + 1)
    }
  }
  return streak(entries, (e) => {
    if (e.gym_actual === 'yes') return true
    if (e.gym_actual === 'no') {
      return (noByWeek.get(weekStartKey(e.date)) ?? 0) <= restBudget
    }
    return false
  })
}

/** Rest days remaining in the current Mon–Sun week. Clamped to 0. */
export function restDaysLeft(entries: Entry[], restBudget: number): number {
  const wk = weekStartKey(todayKey())
  let used = 0
  for (const e of entries) {
    if (e.gym_actual === 'no' && weekStartKey(e.date) === wk) used++
  }
  return Math.max(0, restBudget - used)
}

export const deepWorkStreak = (entries: Entry[]) =>
  streak(entries, (e) => (e.deep_work_actual ?? 0) >= (e.deep_work_target ?? Infinity))
