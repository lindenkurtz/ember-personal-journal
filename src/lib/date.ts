import { format, subDays } from 'date-fns'

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
