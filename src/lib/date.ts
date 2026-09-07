import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek, subDays } from 'date-fns'

/** ISO date key (YYYY-MM-DD) for "today" in the user's local timezone. */
export function todayKey(d: Date = new Date()): string {
  return format(d, 'yyyy-MM-dd')
}

export function dayKey(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

/** Returns an array of ISO date keys for the last `n` days, oldest first, ending today. */
export function lastNDays(n: number, today: Date = new Date()): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(subDays(today, i)))
  return out
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD). Negative if `to` precedes `from`. */
export function daysBetween(from: string, to: string): number {
  return differenceInCalendarDays(parseISO(to), parseISO(from))
}

/** Human label like "Wed, May 14" for headers. */
export function prettyDay(d: Date = new Date()): string {
  return format(d, 'EEE, MMM d')
}

/** Monday-of-the-week ISO date key for a given YYYY-MM-DD. Used to bucket entries into calendar weeks. */
export function weekStartKey(dateKey: string): string {
  return dayKey(startOfWeek(parseISO(dateKey), { weekStartsOn: 1 }))
}

/** `key` shifted by `n` calendar days (negative allowed). */
export function addDaysKey(key: string, n: number): string {
  return dayKey(addDays(parseISO(key), n))
}

/**
 * Sunday key of the screen-time entry week: the most recently completed
 * Sunday–Saturday week, matching iOS Screen Time's own Sun–Sat weekly
 * report reset. The week containing today is never the target — it isn't
 * complete until Saturday is *over* — so every weekday resolves to the
 * previous Sunday and the target rolls over on Sunday, the day entry is
 * prompted. Saturday is not a special case: treating the in-progress week
 * as loggable there made the Dashboard nag for a week that could not yet
 * exist, and offered /screentime a form whose last day hadn't happened.
 */
export function screenTimeWeekStart(today: Date = new Date()): string {
  return addDaysKey(dayKey(startOfWeek(today, { weekStartsOn: 0 })), -7)
}

/** Sunday-of-the-week ISO date key, matching the screen-time Sun–Sat entry cadence. */
export function sundayWeekStartKey(dateKey: string): string {
  return dayKey(startOfWeek(parseISO(dateKey), { weekStartsOn: 0 }))
}
