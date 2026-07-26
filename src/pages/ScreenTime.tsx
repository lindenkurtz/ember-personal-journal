import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { getScreenTimeRange, upsertScreenTimeDays, formatDuration, ScreenTimeRow } from '../lib/screenTime'
import { screenTimeWeekStart, addDaysKey } from '../lib/date'
import DurationWheelPicker from '../components/DurationWheelPicker'
import './ScreenTime.css'

type CellKey = 'phone' | 'pickups' | 'computer'
type Grid = Record<string, Record<CellKey, string>>

const DURATION_KEYS: CellKey[] = ['phone', 'computer']

const COLS: { key: CellKey; label: string }[] = [
  { key: 'phone', label: 'Phone' },
  { key: 'pickups', label: 'Pickups' },
  { key: 'computer', label: 'Computer' }
]

/**
 * Accepts "2h 31m", "2h31m", "2:31", "2h", "31m", or a bare number (read as
 * minutes, for quick entry). Returns null for empty/unparseable input.
 */
function parseDuration(raw: string): number | null {
  const s = raw.trim().toLowerCase()
  if (s === '') return null
  const colon = s.match(/^(\d+):(\d{1,2})$/)
  if (colon) return parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10)
  const hm = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/)
  if (hm && (hm[1] !== undefined || hm[2] !== undefined)) {
    return (hm[1] ? parseInt(hm[1], 10) * 60 : 0) + (hm[2] ? parseInt(hm[2], 10) : 0)
  }
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  return null
}

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
            phone: r.phone_minutes != null ? formatDuration(r.phone_minutes) : '',
            pickups: r.phone_pickups != null ? String(r.phone_pickups) : '',
            computer: r.computer_minutes != null ? formatDuration(r.computer_minutes) : ''
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

  const [picker, setPicker] = useState<{ day: string; key: 'phone' | 'computer' } | null>(null)

  function confirmPicker(minutes: number) {
    if (!picker) return
    setGrid((g) => ({ ...g, [picker.day]: { ...g[picker.day], [picker.key]: formatDuration(minutes) } }))
    setPicker(null)
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
        if (!c || (c.phone.trim() === '' && c.pickups.trim() === '' && c.computer.trim() === '')) continue
        patches.push({
          date: d,
          phone_minutes: parseDuration(c.phone),
          phone_pickups: c.pickups.trim() === '' ? null : parseInt(c.pickups, 10),
          computer_minutes: parseDuration(c.computer)
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
        From iOS Settings → Screen Time. Phone is <strong>total screen
        time</strong>; Computer is Mac + iPad combined. Tap a duration to
        scroll in hours and minutes. Leave unknown days blank — partial
        weeks are fine.
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
            {COLS.map((c) =>
              DURATION_KEYS.includes(c.key) ? (
                <button
                  key={c.key}
                  type="button"
                  className="st__cell st__cell--duration"
                  aria-label={`${format(parseISO(d), 'EEEE, MMM d')} — ${c.label}`}
                  onClick={() => setPicker({ day: d, key: c.key as 'phone' | 'computer' })}
                  disabled={loading}
                >
                  {grid[d]?.[c.key] || <span className="st__cellPlaceholder">—</span>}
                </button>
              ) : (
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
              )
            )}
          </div>
        ))}
      </div>

      {error && <p className="st__error">{error}</p>}
      <button className="st__save" onClick={() => void save()} disabled={loading || saving}>
        {saving ? 'Saving…' : savedFlash ? 'Saved ✓' : 'Save week'}
      </button>

      {picker && (
        <DurationWheelPicker
          title={`${COLS.find((c) => c.key === picker.key)?.label} — ${format(parseISO(picker.day), 'EEEE, MMM d')}`}
          initialMinutes={parseDuration(grid[picker.day]?.[picker.key] ?? '') ?? 0}
          onCancel={() => setPicker(null)}
          onConfirm={confirmPicker}
        />
      )}
    </main>
  )
}
