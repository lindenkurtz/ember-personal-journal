import { Entry } from './entries'
import { lastNDays, todayKey, weekStartKey } from './date'

export type DayResult = 'pass' | 'fail' | 'undecided'

/**
 * Counts consecutive "pass" days ending today, skipping "undecided" days
 * (no row, or the deciding field is still null), and stopping at the first
 * "fail" — the only thing that proves the streak broke.
 */
export function streak(
  entries: Entry[],
  classify: (e: Entry | undefined) => DayResult,
): number {
  const byDate = new Map(entries.map((e) => [e.date, e]))
  const days = lastNDays(60).slice().reverse() // walk back from today
  let n = 0
  for (const d of days) {
    const r = classify(byDate.get(d))
    if (r === 'pass') n++
    else if (r === 'fail') break
    // undecided: skip without breaking
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
    if (!e || e.gym_actual == null) return 'undecided'
    if (e.gym_actual === 'yes') return 'pass'
    return (noByWeek.get(weekStartKey(e.date)) ?? 0) <= restBudget ? 'pass' : 'fail'
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
  streak(entries, (e) => {
    if (!e || e.deep_work_actual == null) return 'undecided'
    return e.deep_work_actual >= (e.deep_work_target ?? Infinity) ? 'pass' : 'fail'
  })
