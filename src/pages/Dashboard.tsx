import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { subDays, parseISO, format } from 'date-fns'
import { Entry, getRange, getEntry } from '../lib/entries'
import { gymStreak, restDaysLeft, deepWorkStreak } from '../lib/streaks'
import { getSettings, PushSettings } from '../lib/settings'
import { prettyDay, todayKey, dayKey } from '../lib/date'
import StatCard from '../components/StatCard'
import CheckInCard from '../components/CheckInCard'
import DotCalendar from '../components/DotCalendar'
import DeepWorkBarChart from '../components/DeepWorkBarChart'
import SleepTrendChart from '../components/SleepTrendChart'
import SocialFrequency from '../components/SocialFrequency'
import './Dashboard.css'

export default function Dashboard() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [today, setToday] = useState<Entry | null>(null)
  const [yesterday, setYesterday] = useState<Entry | null>(null)
  const [settings, setSettings] = useState<PushSettings | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const yKey = dayKey(subDays(new Date(), 1))
    Promise.all([getRange(30), getEntry(todayKey()), getEntry(yKey), getSettings()])
      .then(([range, t, y, s]) => {
        if (cancelled) return
        setEntries(range)
        setToday(t)
        setYesterday(y)
        setSettings(s)
      })
      .catch((err) => console.error('[dashboard]', err))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [])

  const restBudget = settings?.rest_days_per_week ?? 3
  const history = settings?.rest_budget_history
  const gym = gymStreak(entries, restBudget, history)
  const restLeft = restDaysLeft(entries, restBudget, history)
  const dw = deepWorkStreak(entries)

  const morningDone = isMorningDone(today)
  const eveningDone = isEveningDone(today)
  // "Missed yesterday" = yesterday's row exists with morning data but evening
  // never got filled. If the whole day was skipped (no row at all), we don't
  // nudge — that's a normal off day, not a forgotten evening.
  const missedYesterday = !!yesterday && isMorningDone(yesterday) && !isEveningDone(yesterday)

  return (
    <main className="dash">
      <header className="dash__header">
        <div>
          <p className="dash__date">{prettyDay()}</p>
          <h1 className="dash__title">Today</h1>
        </div>
        <div className="dash__headerLinks">
          <Link to="/settings" className="dash__iconLink" aria-label="Settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
          <Link to="/patterns" className="dash__link">Patterns →</Link>
        </div>
      </header>

      {loading ? (
        <p className="muted" style={{ textAlign: 'center', padding: '40px 0' }}>Loading…</p>
      ) : (
        <>
          <section className="dash__checkins">
            {missedYesterday && (
              <CheckInCard
                title={`Missed evening — ${format(parseISO(yesterday!.date), 'EEE')}`}
                summary="Log yesterday's evening before the day's gone."
                status="missed"
                variant="warn"
                to={`/evening?date=${yesterday!.date}`}
              />
            )}
            <CheckInCard
              title={morningDone ? 'Morning check-in' : 'Morning check-in'}
              summary={morningDone ? morningSummary(today!) : 'Bedtime, sleep, gym, deep work target.'}
              status={morningDone ? 'done' : 'pending'}
              variant={morningDone ? 'default' : 'cta'}
              to="/morning"
            />
            <CheckInCard
              title="Evening check-in"
              summary={eveningDone ? eveningSummary(today!) : 'Gym actual, deep work, social, note.'}
              status={eveningDone ? 'done' : 'pending'}
              variant={eveningDone ? 'default' : 'cta'}
              to="/evening"
            />
          </section>

          <section className="dash__stats">
            <StatCard
              label="Gym streak"
              value={<><span className="dash__num">{gym}</span> <span className="dash__unit">{gym === 1 ? 'day' : 'days'}</span></>}
              sublabel={restLeft === 0
                ? 'budget reached this week'
                : `${restLeft} rest ${restLeft === 1 ? 'day' : 'days'} left this week`}
              variant="glow"
            />
            <StatCard
              label="Deep work streak"
              value={<><span className="dash__num">{dw}</span> <span className="dash__unit">{dw === 1 ? 'day' : 'days'}</span></>}
              sublabel="hit your daily target"
            />
          </section>

          <section className="dash__card">
            <div className="dash__cardHeader">
              <h2>Gym — last 30 days</h2>
              <span className="muted">amber = kept</span>
            </div>
            <DotCalendar
              entries={entries}
              label="Gym last 30 days"
              filled={(e) => e?.gym_actual === 'yes'}
            />
          </section>

          <section className="dash__card">
            <div className="dash__cardHeader">
              <h2>Deep work this week</h2>
              <span className="muted">hours, target vs actual</span>
            </div>
            <DeepWorkBarChart entries={entries} />
          </section>

          <section className="dash__card">
            <div className="dash__cardHeader">
              <h2>Sleep quality</h2>
              <span className="muted">last 14 nights</span>
            </div>
            <SleepTrendChart entries={entries} />
          </section>

          <section className="dash__card">
            <div className="dash__cardHeader">
              <h2>Social time</h2>
            </div>
            <SocialFrequency entries={entries} />
          </section>
        </>
      )}
    </main>
  )
}

function isMorningDone(e: Entry | null): boolean {
  return !!e && !!e.bedtime && !!e.wake_time && e.sleep_quality !== null && e.gym_intention !== null
}

function isEveningDone(e: Entry | null): boolean {
  return !!e && e.gym_actual !== null && e.deep_work_actual !== null && e.social !== null
}

function morningSummary(e: Entry): string {
  const parts: string[] = []
  if (e.sleep_quality) parts.push(`${'★'.repeat(e.sleep_quality)} sleep`)
  if (e.gym_intention) parts.push(`gym ${e.gym_intention}`)
  if (e.deep_work_target !== null && e.deep_work_target !== undefined)
    parts.push(`${e.deep_work_target}h target`)
  return parts.join(' · ')
}

function eveningSummary(e: Entry): string {
  const parts: string[] = []
  if (e.gym_actual) parts.push(`gym ${e.gym_actual}`)
  if (e.deep_work_actual !== null) parts.push(`${e.deep_work_actual}h done`)
  if (e.social !== null) parts.push(e.social ? 'social' : 'solo')
  return parts.join(' · ')
}
