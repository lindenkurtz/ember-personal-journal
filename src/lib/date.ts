import { format, parseISO, startOfWeek, subDays } from 'date-fns'

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

/** Human label like "Wed, May 14" for headers. */
export function prettyDay(d: Date = new Date()): string {
  return format(d, 'EEE, MMM d')
}

/** Monday-of-the-week ISO date key for a given YYYY-MM-DD. Used to bucket entries into calendar weeks. */
export function weekStartKey(dateKey: string): string {
  return dayKey(startOfWeek(parseISO(dateKey), { weekStartsOn: 1 }))
}

/** Year-month key (YYYY-MM) for a YYYY-MM-DD, or for "now" with no arg. */
export function monthKey(dateKey: string = todayKey()): string {
  return dateKey.slice(0, 7)
}

/** First and last ISO date keys of a YYYY-MM month. */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` }
}

/** The YYYY-MM key for the month before `month`. */
export function prevMonthKey(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Human label like "June 2026" for a YYYY-MM key. */
export function prettyMonth(month: string): string {
  return format(parseISO(`${month}-01`), 'MMMM yyyy')
}
