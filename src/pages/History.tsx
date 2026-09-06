import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { Entry, getAllEntries, CONFOUND_KEYS, CONFOUND_LABELS } from '../lib/entries'
import { getAllScreenTime, ScreenTimeRow } from '../lib/screenTime'
import { listContextPeriods, periodForDate, ContextPeriod } from '../lib/contextPeriods'
import './History.css'

/**
 * Read-only look-back over every recorded day. This is the permanent home of
 * the retired deep-work data (May–June 2026) and where confound flags show up
 * as badges.
 */
export default function History() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [screen, setScreen] = useState<ScreenTimeRow[]>([])
  const [periods, setPeriods] = useState<ContextPeriod[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      getAllEntries(),
      getAllScreenTime().catch(() => [] as ScreenTimeRow[]),
      listContextPeriods().catch(() => [] as ContextPeriod[])
    ])
      .then(([es, st, ps]) => {
        if (cancelled) return
        setEntries(es)
        setScreen(st)
        setPeriods(ps)
      })
      .catch((err) => console.error('[history]', err))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [])

  const screenByDate = useMemo(() => new Map(screen.map((r) => [r.date, r])), [screen])
  const rows = useMemo(() => entries.slice().reverse(), [entries])

  return (
    <main className="history">
      <header className="history__header">
        <Link to="/" className="history__back">← Today</Link>
        <h1 className="history__title">History</h1>
      </header>

      {loading ? (
        <p className="history__empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="history__empty">No entries yet.</p>
      ) : (
        <ul className="history__list">
          {rows.map((e) => {
            const flags = CONFOUND_KEYS.filter((k) => e[k] === true)
            const open = expanded === e.date
            return (
              <li key={e.date} className="history__item">
                <button
                  className="history__rowBtn"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : e.date)}
                >
                  <div className="history__rowMain">
                    <span className="history__date">{format(parseISO(e.date), 'EEE, MMM d')}</span>
                    <span className="history__summary">{compactSummary(e)}</span>
                  </div>
                  {flags.length > 0 && (
                    <span className="history__flags">
                      {flags.map((k) => (
                        <span key={k} className="history__flag">{CONFOUND_LABELS[k]}</span>
                      ))}
                    </span>
                  )}
                </button>
                {open && (
                  <DayDetail
                    e={e}
                    st={screenByDate.get(e.date)}
                    period={periodForDate(periods, e.date)}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}

function compactSummary(e: Entry): string {
  const parts: string[] = []
  if (e.sleep_quality) parts.push(`${'★'.repeat(e.sleep_quality)} sleep`)
  if (e.day_quality) parts.push(`${'★'.repeat(e.day_quality)} day`)
  if (e.gym_actual) parts.push(`gym ${e.gym_actual}`)
  if (e.social != null) parts.push(e.social ? 'social' : 'solo')
  return parts.join(' · ') || '—'
}

/** Postgres `time` columns come back as 'HH:MM:SS'; show 'HH:MM'. */
function fmtTime(t: string | null): string | null {
  return t ? t.slice(0, 5) : null
}

function DayDetail({
  e,
  st,
  period
}: {
  e: Entry
  st?: ScreenTimeRow
  period: ContextPeriod | null
}) {
  const flags = CONFOUND_KEYS.filter((k) => e[k] === true)
  const confoundsTracked = CONFOUND_KEYS.some((k) => e[k] != null)
  const legacyDw =
    e.deep_work_planned != null ||
    e.deep_work_plan_note != null ||
    e.deep_work_actual != null ||
    e.deep_work_target != null ||
    e.deep_work_start != null

  return (
    <div className="history__detail">
      {period && <DetailRow label="Context" value={period.label} />}
      {(e.bedtime || e.wake_time) && (
        <DetailRow
          label="Sleep window"
          value={`${fmtTime(e.bedtime) ?? '—'} → ${fmtTime(e.wake_time) ?? '—'}`}
        />
      )}
      {e.sleep_quality != null && <DetailRow label="Sleep quality" value={'★'.repeat(e.sleep_quality)} />}
      {e.day_quality != null && <DetailRow label="Day quality" value={'★'.repeat(e.day_quality)} />}
      {(e.gym_intention || e.gym_actual) && (
        <DetailRow label="Gym" value={`${e.gym_intention ?? '—'} → ${e.gym_actual ?? '—'}`} />
      )}
      {e.focused_work != null && <DetailRow label="Focused work" value={e.focused_work} />}
      {e.last_meal_start_time != null && (
        <DetailRow label="Last meal" value={fmtTime(e.last_meal_start_time)!} />
      )}
      {e.social != null && <DetailRow label="Social" value={e.social ? 'yes' : 'no'} />}
      <DetailRow
        label="Confounds"
        value={
          !confoundsTracked
            ? 'not tracked'
            : flags.length === 0
              ? 'none'
              : flags.map((k) => CONFOUND_LABELS[k]).join(', ')
        }
      />
      {legacyDw && (
        <DetailRow
          label="Deep work (legacy)"
          value={[
            e.deep_work_planned != null ? `planned ${e.deep_work_planned}` : null,
            e.deep_work_actual != null ? `${e.deep_work_actual}h done` : null,
            e.deep_work_target != null ? `target ${e.deep_work_target}h` : null,
            e.deep_work_start != null ? `start ${fmtTime(e.deep_work_start)}` : null,
            e.deep_work_plan_note ? `“${e.deep_work_plan_note}”` : null
          ].filter(Boolean).join(' · ')}
        />
      )}
      {st && (
        <DetailRow
          label="Screen time"
          value={[
            st.phone_minutes != null ? `phone ${st.phone_minutes}m` : null,
            st.phone_pickups != null ? `${st.phone_pickups} pickups` : null,
            st.ipad_minutes != null ? `iPad ${st.ipad_minutes}m` : null
          ].filter(Boolean).join(' · ')}
        />
      )}
      {(e.hrv_avg != null || e.resting_hr != null || e.steps != null) && (
        <DetailRow
          label="Body"
          value={[
            e.hrv_avg != null ? `HRV ${e.hrv_avg}` : null,
            e.resting_hr != null ? `RHR ${e.resting_hr}` : null,
            e.steps != null ? `${e.steps.toLocaleString()} steps` : null
          ].filter(Boolean).join(' · ')}
        />
      )}
      {e.weather_temp_f != null && <DetailRow label="Weather" value={`${e.weather_temp_f}°F`} />}
      {e.note && <DetailRow label="Note" value={e.note} />}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="history__detailRow">
      <span className="history__detailLabel">{label}</span>
      <span className="history__detailValue">{value}</span>
    </div>
  )
}
