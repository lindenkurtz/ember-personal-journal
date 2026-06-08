import { Entry } from './entries'
import { lastNDays, todayKey, weekStartKey } from './date'
import { BudgetChange } from './settings'

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
 * Returns the rest-day budget effective during the week starting at
 * `weekStart`. Walks `history` for the latest entry with `from <= weekStart`;
 * falls back to `currentBudget` when history is empty or the week predates
 * all entries.
 */
export function budgetForWeek(
  weekStart: string,
  history: BudgetChange[] | undefined,
  currentBudget: number
): number {
  if (!history || history.length === 0) return currentBudget
  let match: BudgetChange | null = null
  for (const entry of history) {
    if (entry.from <= weekStart) match = entry
    else break
  }
  return match ? match.budget : currentBudget
}

/**
 * Gym streak with a weekly rest budget. A 'no' day is "kept" only if the
 * total 'no' count within its calendar week (Mon–Sun) is at most that week's
 * budget. The budget is resolved per-week from `history` so a budget change
 * never retroactively breaks past weeks.
 */
export function gymStreak(
  entries: Entry[],
  currentBudget: number,
  history?: BudgetChange[]
): number {
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
    const wk = weekStartKey(e.date)
    const budget = budgetForWeek(wk, history, currentBudget)
    return (noByWeek.get(wk) ?? 0) <= budget ? 'pass' : 'fail'
  })
}

/** Rest days remaining in the current Mon–Sun week. Clamped to 0. */
export function restDaysLeft(
  entries: Entry[],
  currentBudget: number,
  history?: BudgetChange[]
): number {
  const wk = weekStartKey(todayKey())
  let used = 0
  for (const e of entries) {
    if (e.gym_actual === 'no' && weekStartKey(e.date) === wk) used++
  }
  const budget = budgetForWeek(wk, history, currentBudget)
  return Math.max(0, budget - used)
}

/**
 * Deep work streak with a weekly rest budget. A day with 0 hours logged is a
 * "no" and counts against the weekly budget; any hours > 0 is a pass.
 */
export function deepWorkStreak(
  entries: Entry[],
  currentBudget: number,
  history?: BudgetChange[]
): number {
  const noByWeek = new Map<string, number>()
  for (const e of entries) {
    if (e.deep_work_actual !== null && e.deep_work_actual === 0) {
      const wk = weekStartKey(e.date)
      noByWeek.set(wk, (noByWeek.get(wk) ?? 0) + 1)
    }
  }
  return streak(entries, (e) => {
    if (!e || e.deep_work_actual == null) return 'undecided'
    if (e.deep_work_actual > 0) return 'pass'
    const wk = weekStartKey(e.date)
    const budget = budgetForWeek(wk, history, currentBudget)
    return (noByWeek.get(wk) ?? 0) <= budget ? 'pass' : 'fail'
  })
}

/** Rest days remaining in the current Mon–Sun week for the deep work streak. Clamped to 0. */
export function deepWorkRestDaysLeft(
  entries: Entry[],
  currentBudget: number,
  history?: BudgetChange[]
): number {
  const wk = weekStartKey(todayKey())
  let used = 0
  for (const e of entries) {
    if (e.deep_work_actual !== null && e.deep_work_actual === 0 && weekStartKey(e.date) === wk) used++
  }
  const budget = budgetForWeek(wk, history, currentBudget)
  return Math.max(0, budget - used)
}

function bestStreak(
  classifier: (dateKey: string) => DayResult,
  sortedDates: string[]
): number {
  let best = 0, current = 0
  for (const d of sortedDates) {
    const r = classifier(d)
    if (r === 'pass') { current++; if (current > best) best = current }
    else if (r === 'fail') current = 0
  }
  return best
}

export function bestGymStreak(
  entries: Entry[],
  currentBudget: number,
  history?: BudgetChange[]
): number {
  const byDate = new Map(entries.map((e) => [e.date, e]))
  const noByWeek = new Map<string, number>()
  for (const e of entries) {
    if (e.gym_actual === 'no') {
      const wk = weekStartKey(e.date)
      noByWeek.set(wk, (noByWeek.get(wk) ?? 0) + 1)
    }
  }
  const sortedDates = [...byDate.keys()].sort()
  return bestStreak((d) => {
    const e = byDate.get(d)
    if (!e || e.gym_actual == null) return 'undecided'
    if (e.gym_actual === 'yes') return 'pass'
    const wk = weekStartKey(d)
    const budget = budgetForWeek(wk, history, currentBudget)
    return (noByWeek.get(wk) ?? 0) <= budget ? 'pass' : 'fail'
  }, sortedDates)
}

export function bestDeepWorkStreak(
  entries: Entry[],
  currentBudget: number,
  history?: BudgetChange[]
): number {
  const byDate = new Map(entries.map((e) => [e.date, e]))
  const noByWeek = new Map<string, number>()
  for (const e of entries) {
    if (e.deep_work_actual !== null && e.deep_work_actual === 0) {
      const wk = weekStartKey(e.date)
      noByWeek.set(wk, (noByWeek.get(wk) ?? 0) + 1)
    }
  }
  const sortedDates = [...byDate.keys()].sort()
  return bestStreak((d) => {
    const e = byDate.get(d)
    if (!e || e.deep_work_actual == null) return 'undecided'
    if (e.deep_work_actual > 0) return 'pass'
    const wk = weekStartKey(d)
    const budget = budgetForWeek(wk, history, currentBudget)
    return (noByWeek.get(wk) ?? 0) <= budget ? 'pass' : 'fail'
  }, sortedDates)
}
