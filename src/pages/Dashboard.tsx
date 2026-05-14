import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { subDays, parseISO, format } from 'date-fns'
import { Entry, getRange, getEntry } from '../lib/entries'
import { gymStreak, deepWorkStreak } from '../lib/streaks'
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
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const yKey = dayKey(subDays(new Date(), 1))
    Promise.all([getRange(30), getEntry(todayKey()), getEntry(yKey)])
      .then(([range, t, y]) => {
        if (cancelled) return
        setEntries(range)
        setToday(t)
        setYesterday(y)
      })
      .catch((err) => console.error('[dashboard]', err))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [])

  const gym = gymStreak(entries)
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
        <Link to="/patterns" className="dash__link">Patterns →</Link>
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
              sublabel="rest days count"
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
              filled={(e) => e?.gym_actual === 'yes' || e?.gym_actual === 'rest'}
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
  return !!e && !!e.bedtime && e.sleep_quality !== null && e.gym_intention !== null
}

function isEveningDone(e: Entry | null): boolean {
  return !!e && e.gym_actual !== null && e.deep_work_actual !== null && e.social !== null
}

function morningSummary(e: Entry): string {
  const parts: string[] = []
  if (e.sleep_quality) parts.push(`${'★'.repeat(e.sleep_quality)} sleep`)
  if (e.gym_intention) parts.push(`gym ${labelGym(e.gym_intention)}`)
  if (e.deep_work_target) parts.push(`${e.deep_work_target}h target`)
  return parts.join(' · ')
}

function eveningSummary(e: Entry): string {
  const parts: string[] = []
  if (e.gym_actual) parts.push(`gym ${labelGym(e.gym_actual)}`)
  if (e.deep_work_actual !== null) parts.push(`${e.deep_work_actual}h done`)
  if (e.social !== null) parts.push(e.social ? 'social' : 'solo')
  return parts.join(' · ')
}

function labelGym(g: string): string {
  return g === 'rest' ? 'rest' : g
}
