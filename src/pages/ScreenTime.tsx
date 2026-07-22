import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { getScreenTimeRange, upsertScreenTimeDays, ScreenTimeRow } from '../lib/screenTime'
import { screenTimeWeekStart, addDaysKey } from '../lib/date'
import './ScreenTime.css'

type CellKey = 'phone' | 'pickups' | 'computer'
type Grid = Record<string, Record<CellKey, string>>

const COLS: { key: CellKey; label: string }[] = [
  { key: 'phone', label: 'Phone (min)' },
  { key: 'pickups', label: 'Pickups' },
  { key: 'computer', label: 'Computer (min)' }
]

/**
 * Weekly batch entry for daily screen-time values, copied from iOS
 * Settings → Screen Time on Sunday nights. Blank cells are never written, so
 * partial weeks save fine.
 */
export default function ScreenTime() {
  const latestWeek = screenTimeWeekStart()
  const [weekStart, setWeekStart] = useState(latestWeek)
  const [grid, setGrid] = useState<Grid>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysKey(weekStart, i)),
    [weekStart]
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const empty: Grid = Object.fromEntries(
      days.map((d) => [d, { phone: '', pickups: '', computer: '' }])
    )
    getScreenTimeRange(weekStart, addDaysKey(weekStart, 6))
      .then((rows) => {
        if (cancelled) return
        const g = { ...empty }
        for (const r of rows) {
          g[r.date] = {
            phone: r.phone_minutes != null ? String(r.phone_minutes) : '',
            pickups: r.phone_pickups != null ? String(r.phone_pickups) : '',
            computer: r.computer_minutes != null ? String(r.computer_minutes) : ''
          }
        }
        setGrid(g)
      })
      .catch(() => { if (!cancelled) setGrid(empty) }) // offline — still allow fresh entry
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [weekStart, days])

  function setCell(d: string, key: CellKey, raw: string) {
    const v = raw.replace(/\D/g, '')
    setGrid((g) => ({ ...g, [d]: { ...g[d], [key]: v } }))
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const patches: ScreenTimeRow[] = []
      for (const d of days) {
        const c = grid[d]
        // All-blank days are skipped entirely — no data must stay "no row",
        // not a row of nulls.
        if (!c || (c.phone === '' && c.pickups === '' && c.computer === '')) continue
        patches.push({
          date: d,
          phone_minutes: c.phone === '' ? null : parseInt(c.phone, 10),
          phone_pickups: c.pickups === '' ? null : parseInt(c.pickups, 10),
          computer_minutes: c.computer === '' ? null : parseInt(c.computer, 10)
        })
      }
      await upsertScreenTimeDays(patches)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    } catch (err) {
      console.error(err)
      setError("Couldn't save just now. Try again in a moment.")
    } finally {
      setSaving(false)
    }
  }

  const weekLabel = `${format(parseISO(weekStart), 'MMM d')} – ${format(parseISO(addDaysKey(weekStart, 6)), 'MMM d')}`

  return (
    <main className="st">
      <header className="st__header">
        <Link to="/" className="st__back">← Today</Link>
        <h1 className="st__title">Screen time</h1>
      </header>

      <div className="st__weekNav">
        <button
          className="st__weekBtn"
          aria-label="Previous week"
          onClick={() => setWeekStart(addDaysKey(weekStart, -7))}
        >
          ←
        </button>
        <span className="st__weekLabel">{weekLabel}</span>
        <button
          className="st__weekBtn"
          aria-label="Next week"
          disabled={weekStart === latestWeek}
          onClick={() => setWeekStart(addDaysKey(weekStart, 7))}
        >
          →
        </button>
      </div>

      <p className="st__hint">
        From iOS Settings → Screen Time. Phone counts <strong>Social +
        Entertainment only</strong>; Computer is Mac + iPad combined. Leave
        unknown days blank — partial weeks are fine.
      </p>

      <div className="st__grid">
        <div className="st__gridRow st__gridRow--head">
          <span className="st__day" />
          {COLS.map((c) => (
            <span key={c.key} className="st__colLabel">{c.label}</span>
          ))}
        </div>
        {days.map((d) => (
          <div key={d} className="st__gridRow">
            <span className="st__day">{format(parseISO(d), 'EEE d')}</span>
            {COLS.map((c) => (
              <input
                key={c.key}
                className="st__cell"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="—"
                aria-label={`${format(parseISO(d), 'EEEE, MMM d')} — ${c.label}`}
                value={grid[d]?.[c.key] ?? ''}
                onChange={(ev) => setCell(d, c.key, ev.target.value)}
                disabled={loading}
              />
            ))}
          </div>
        ))}
      </div>

      {error && <p className="st__error">{error}</p>}
      <button className="st__save" onClick={() => void save()} disabled={loading || saving}>
        {saving ? 'Saving…' : savedFlash ? 'Saved ✓' : 'Save week'}
      </button>
    </main>
  )
}
