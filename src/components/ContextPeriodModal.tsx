import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ContextPeriod,
  createContextPeriod,
  updateContextPeriod,
  deleteContextPeriod,
  listContextPeriods
} from '../lib/contextPeriods'
import { todayKey, addDaysKey } from '../lib/date'
import './ContextPeriodModal.css'

interface Props {
  periods: ContextPeriod[]
  onClose: () => void
  onChanged: (next: ContextPeriod[]) => void
}

/** Lightweight editor for context periods — reached from the Dashboard's
 * "No context set for today" banner, touched a few times a year. */
export default function ContextPeriodModal({ periods, onClose, onChanged }: Props) {
  // Inclusive bounds on the DB overlap constraint: adjacent periods must not
  // share a day, so a new one defaults to the day after the latest end_date.
  const latestEnd = periods.reduce<string | null>(
    (acc, p) => (p.end_date && (!acc || p.end_date > acc) ? p.end_date : acc),
    null
  )
  const hasActive = periods.some((p) => p.end_date === null)

  const [endingId, setEndingId] = useState<number | null>(null)
  const [endDraft, setEndDraft] = useState(todayKey())
  const [label, setLabel] = useState('')
  const [start, setStart] = useState(latestEnd ? addDaysKey(latestEnd, 1) : todayKey())
  const [end, setEnd] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      onChanged(await listContextPeriods())
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function endPeriod(id: number) {
    if (await run(() => updateContextPeriod(id, { end_date: endDraft }))) {
      setEndingId(null)
    }
  }

  async function add() {
    if (await run(() =>
      createContextPeriod({ label: label.trim(), start_date: start, end_date: end || null })
    )) {
      setLabel('')
      setEnd('')
    }
  }

  return (
    <div className="ctxmodal__overlay" onClick={onClose}>
      <div className="ctxmodal" role="dialog" aria-label="Context periods" onClick={(e) => e.stopPropagation()}>
        <div className="ctxmodal__head">
          <div>
            <h2 className="ctxmodal__title">Context periods</h2>
            <p className="ctxmodal__hint">
              Which phase of life a date falls in — summer, semester, break —
              so entries can be grouped in analysis. Periods can't overlap; a
              new one starts the day after the last one ends.
            </p>
          </div>
          <button className="ctxmodal__close" aria-label="Close" onClick={onClose}>×</button>
        </div>

        <ul className="ctxmodal__list">
          {periods.map((p) => (
            <li key={p.id} className="ctxmodal__row">
              <div className="ctxmodal__info">
                <span className="ctxmodal__label">{p.label}</span>
                <span className="ctxmodal__dates">
                  {format(parseISO(p.start_date), 'MMM d, yyyy')} →{' '}
                  {p.end_date ? format(parseISO(p.end_date), 'MMM d, yyyy') : 'present'}
                </span>
              </div>
              <div className="ctxmodal__rowActions">
                {p.end_date === null &&
                  (endingId === p.id ? (
                    <>
                      <input
                        type="date"
                        value={endDraft}
                        aria-label={`End date for ${p.label}`}
                        onChange={(e) => setEndDraft(e.target.value)}
                      />
                      <button
                        className="ctxmodal__btn"
                        disabled={busy || !endDraft}
                        onClick={() => void endPeriod(p.id)}
                      >
                        End
                      </button>
                    </>
                  ) : (
                    <button
                      className="ctxmodal__btn"
                      disabled={busy}
                      onClick={() => { setEndingId(p.id); setEndDraft(todayKey()) }}
                    >
                      End…
                    </button>
                  ))}
                <button
                  className="ctxmodal__btn ctxmodal__btn--danger"
                  disabled={busy}
                  onClick={() => void run(() => deleteContextPeriod(p.id))}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
          {periods.length === 0 && <li className="ctxmodal__empty">No periods yet.</li>}
        </ul>

        <div className="ctxmodal__form">
          <label className="ctxmodal__field">
            <span>Label</span>
            <input
              type="text"
              placeholder="e.g. fall_2026"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <div className="ctxmodal__formRow">
            <label className="ctxmodal__field">
              <span>Start</span>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="ctxmodal__field">
              <span>End (blank = active)</span>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
          {hasActive && !end && (
            <p className="ctxmodal__hint">
              An open-ended period is already active — end it first, or give the
              new one an end date in the past.
            </p>
          )}
          <button
            className="ctxmodal__add"
            disabled={busy || !label.trim() || !start}
            onClick={() => void add()}
          >
            Add period
          </button>
        </div>

        {error && <p className="ctxmodal__error">{error}</p>}
      </div>
    </div>
  )
}
