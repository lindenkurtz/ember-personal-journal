import { Entry, CONFOUND_KEYS, ConfoundKey } from './entries'
import { ScreenTimeRow } from './screenTime'
import { ContextPeriod } from './contextPeriods'

// One row builder + one legend shared by the Patterns analysis and the morning
// nudge so a new tracked field can never appear in one prompt and not the other
// (CLAUDE.md: every field is a predictor; dq stays the single target).

const FLAG_CODES: Record<ConfoundKey, string> = {
  sick: 'sick',
  alcohol: 'alc',
  slept_away: 'away',
  travel_day: 'trav',
  caffeine_late: 'caff',
  deadline_pressure: 'ddl'
}

/**
 * Compact per-day rows. `flags` is only present when the confounds were
 * tracked that day (post mid-July 2026): [] = tracked-and-nothing-unusual,
 * absent = untracked — the legend spells this out for the model. Screen-time
 * keys appear only on days that have a row.
 */
export function buildCompactRows(
  entries: Entry[],
  screenByDate: Map<string, ScreenTimeRow>,
  opts: { notes?: boolean } = {}
): Record<string, unknown>[] {
  return entries.map((e) => {
    const row: Record<string, unknown> = {
      d: e.date,
      bed: e.bedtime,
      wake: e.wake_time,
      sleep: e.sleep_quality,
      sleep_h: e.sleep_hours,
      dq: e.day_quality,
      gym_i: e.gym_intention,
      gym_a: e.gym_actual,
      dw_p: e.deep_work_planned,
      dw_a: e.deep_work_actual,
      fw: e.focused_work,
      meal: e.last_meal_start_time ? e.last_meal_start_time.slice(0, 5) : null,
      soc: e.social,
      hrv: e.hrv_avg,
      rhr: e.resting_hr,
      steps: e.steps,
      tempF: e.weather_temp_f,
      wcode: e.weather_code
    }
    if (CONFOUND_KEYS.some((k) => e[k] != null)) {
      row.flags = CONFOUND_KEYS.filter((k) => e[k] === true).map((k) => FLAG_CODES[k])
    }
    const st = screenByDate.get(e.date)
    if (st) {
      row.st_ph = st.phone_minutes
      row.st_pu = st.phone_pickups
      row.st_pc = st.computer_minutes
    }
    if (opts.notes) row.note = e.note
    return row
  })
}

export const FIELD_LEGEND = [
  'Field key (all fields nullable; null = not logged):',
  "  d = date. bed = bedtime, wake = wake time — both 'HH:MM' local clock times, NOT durations.",
  '  sleep = self-reported sleep quality 1–5 (subjective). sleep_h = objective sleep duration in hours from Apple Watch — both describe the night ending that morning; discrepancies between them are worth surfacing.',
  '  dq = self-reported day quality 1–5 (PRIMARY TARGET — find what predicts this).',
  "  gym_i = morning gym intention ('yes'|'no'), gym_a = evening actual.",
  '  dw_p / dw_a = deep-work intention / actual hours — tracking RETIRED mid-July 2026 and replaced by fw; values exist only on older dates.',
  "  fw = focused work: 'none' | 'light' (<1h) | 'solid' (1–3h) | 'deep' (3h+). Cognitively demanding self-directed work only. Asked from 2026-08-15.",
  "  meal = 'HH:MM' the last meal of the day was STARTED.",
  '  flags = confound flags true that day: sick; alc = alcohol; away = slept away from home (the night ending that morning — same night as the sleep fields); trav = 3+ hours in transit; caff = caffeine after ~2pm; ddl = exam or major deadline within 48h.',
  '    flags: [] means tracked, nothing unusual. flags ABSENT from a row means confounds were not yet tracked that day — never read absence as "none".',
  '    Treat flags as confounders: rare events that distort sleep and day quality. Use them to explain outliers and discount distorted days — they are not goals and never a target.',
  '  st_ph = phone screen minutes (total screen time), st_pu = phone pickups, st_pc = computer minutes (Mac + iPad combined). Entered weekly, so missing on many days. Phone and computer are deliberately separate — Instagram is blocked on the phone and scrolling moved to the computer, so a merged total would mislead.',
  '  soc = had meaningful social time (boolean).',
  '  hrv = avg heart-rate variability (ms), rhr = resting heart rate (bpm), steps = daily steps.',
  '  tempF = outside °F at morning check-in, wcode = Open-Meteo WMO weather code.',
  '  note = freetext note about the day (when present).'
].join('\n')

export const SPARSE_NOTE =
  'HRV, resting heart rate, steps, sleep_h, weather, and screen time (st_*) are sparsely populated ' +
  'signals. Only draw conclusions from them when enough non-null values exist; always caveat findings ' +
  'based on sparse data, and never treat a missing value as zero. They help explain patterns in the ' +
  'primary metrics (sleep, gym, focused work) — they are not goals in themselves.'

/** One preamble line naming the life phases so the model can group by them. */
export function contextHeader(periods: ContextPeriod[]): string {
  if (periods.length === 0) return ''
  const spans = periods
    .map((p) => `${p.label} = ${p.start_date} → ${p.end_date ?? 'present'}`)
    .join('; ')
  return `Context periods (life phases — group or contrast by these where useful): ${spans}`
}
