import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { subDays, parseISO, format } from 'date-fns'
import { Entry, getRange, getEntry, getAllEntries } from '../lib/entries'
import { gymStreak, restDaysLeft, bestGymStreak } from '../lib/streaks'
import { getSettings, PushSettings } from '../lib/settings'
import { getScreenTimeRange, getAllScreenTime, phoneTimeTrend, ScreenTimeRow, PhoneTimeTrend } from '../lib/screenTime'
import { listContextPeriods, periodForDate, ContextPeriod } from '../lib/contextPeriods'
import { getFinanceSettings } from '../lib/finance/settings'
import { getLatestLoan, semesterLoanDue } from '../lib/finance/loans'
import type { FinanceSettings, LoanBalance } from '../../shared/finance/types'
import { prettyDay, todayKey, dayKey, screenTimeWeekStart, addDaysKey } from '../lib/date'
import StatCard from '../components/StatCard'
import CheckInCard from '../components/CheckInCard'
import DotCalendar from '../components/DotCalendar'
import SleepTrendChart from '../components/SleepTrendChart'
import SocialFrequency from '../components/SocialFrequency'
import ScreenTimeTrendCard from '../components/ScreenTimeTrendCard'
import ContextPeriodModal from '../components/ContextPeriodModal'
import './Dashboard.css'

const CTX_DISMISS_KEY = 'ember:ctxDismissed'

export default function Dashboard() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [allEntries, setAllEntries] = useState<Entry[]>([])
  const [today, setToday] = useState<Entry | null>(null)
  const [yesterday, setYesterday] = useState<Entry | null>(null)
  const [settings, setSettings] = useState<PushSettings | null>(null)
  // null = fetch failed (offline, table missing) — degrade by hiding the
  // banner/nag rather than falsely claiming nothing is set/logged.
  const [periods, setPeriods] = useState<ContextPeriod[] | null>(null)
  const [screenWeek, setScreenWeek] = useState<ScreenTimeRow[] | null>(null)
  const [screenTrend, setScreenTrend] = useState<PhoneTimeTrend | null>(null)
  // Loan reminder inputs. `undefined` is the not-loaded/failed state here
  // because `null` already means "no loan row yet" — a real, naggable value.
  const [financeCfg, setFinanceCfg] = useState<FinanceSettings | null>(null)
  const [loan, setLoan] = useState<LoanBalance | null | undefined>(undefined)
  const [showCtxEditor, setShowCtxEditor] = useState(false)
  const [ctxDismissed, setCtxDismissed] = useState(
    () => localStorage.getItem(CTX_DISMISS_KEY) === todayKey()
  )
  const [loading, setLoading] = useState(true)

  const stWeekStart = screenTimeWeekStart()
  const stWeekEnd = addDaysKey(stWeekStart, 6)

  useEffect(() => {
    let cancelled = false
    const yKey = dayKey(subDays(new Date(), 1))
    const wk = screenTimeWeekStart()
    Promise.all([
      getRange(30),
      getEntry(todayKey()),
      getEntry(yKey),
      getSettings(),
      getAllEntries(),
      listContextPeriods().catch(() => null),
      getScreenTimeRange(wk, addDaysKey(wk, 6)).catch(() => null),
      getAllScreenTime().catch(() => null),
      getFinanceSettings().catch(() => null),
      getLatestLoan().catch(() => undefined)
    ])
      .then(([range, t, y, s, all, ps, st, allScreen, fin, ln]) => {
        if (cancelled) return
        setEntries(range)
        setAllEntries(all)
        setToday(t)
        setYesterday(y)
        setSettings(s)
        setPeriods(ps)
        setScreenWeek(st)
        setScreenTrend(allScreen ? phoneTimeTrend(allScreen) : null)
        setFinanceCfg(fin)
        setLoan(ln)
      })
      .catch((err) => console.error('[dashboard]', err))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [])

  const restBudget = settings?.rest_days_per_week ?? 3
  const history = settings?.rest_budget_history
  const gym = gymStreak(allEntries, restBudget, history)
  const restLeft = restDaysLeft(allEntries, restBudget, history)
  const bestGym = bestGymStreak(allEntries, restBudget, history)

  const morningDone = isMorningDone(today)
  const eveningDone = isEveningDone(today)
  // "Missed yesterday" = yesterday's row exists with morning data but evening
  // never got filled. If the whole day was skipped (no row at all), we don't
  // nudge — that's a normal off day, not a forgotten evening.
  const missedYesterday = !!yesterday && isMorningDone(yesterday) && !isEveningDone(yesterday)

  // Weekly screen-time nag: only when the target week has ZERO rows. Once any
  // day is saved the week counts as logged — partial weeks are intentional and
  // must never nag forever.
  const screenTimeMissing = screenWeek !== null && screenWeek.length === 0
  // Per-semester loan nag. Hidden outright when either fetch failed, so a
  // finance outage never claims the balance is stale.
  const loanDue = loan === undefined || !financeCfg
    ? null
    : semesterLoanDue(financeCfg.semester_starts, loan, todayKey())

  const noContextToday =
    !loading && periods !== null && !periodForDate(periods, todayKey()) && !ctxDismissed

  function dismissCtx() {
    localStorage.setItem(CTX_DISMISS_KEY, todayKey())
    setCtxDismissed(true)
  }

  return (
    <main className="page dash">
      <header className="dash__header">
        <div>
          <p className="dash__date">{prettyDay()}</p>
          <h1 className="dash__title">Today</h1>
        </div>
        <div className="dash__headerLinks">
          <Link to="/finance" className="dash__link">Finance</Link>
          <Link to="/patterns" className="dash__link">Patterns</Link>
          <Link to="/history" className="dash__link">History</Link>
          <Link to="/settings" className="dash__iconLink" aria-label="Settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
        </div>
      </header>

      {noContextToday && (
        <div className="dash__ctxBanner">
          <span>No context set for today.</span>
          <div className="dash__ctxActions">
            <button className="dash__ctxSet" onClick={() => setShowCtxEditor(true)}>Set</button>
            <button className="dash__ctxDismiss" aria-label="Dismiss" onClick={dismissCtx}>×</button>
          </div>
        </div>
      )}

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
              title="Morning check-in"
              summary={morningDone ? morningSummary(today!) : 'Bedtime, sleep, gym.'}
              status={morningDone ? 'done' : 'pending'}
              variant={morningDone ? 'default' : 'cta'}
              to="/morning"
            />
            <CheckInCard
              title="Evening check-in"
              summary={eveningDone ? eveningSummary(today!) : 'Gym, meal time, social, how the day went.'}
              status={eveningDone ? 'done' : 'pending'}
              variant={eveningDone ? 'default' : 'cta'}
              to="/evening"
            />
            {loanDue && (
              <CheckInCard
                title="Loan balance — new semester"
                summary={`Term started ${format(parseISO(loanDue), 'MMM d')}. Update the balance after this semester's disbursement.`}
                status="missed"
                variant="warn"
                to="/finance"
              />
            )}
            {screenTimeMissing && (
              <CheckInCard
                title="Screen time — last week"
                summary={`${format(parseISO(stWeekStart), 'MMM d')} – ${format(parseISO(stWeekEnd), 'MMM d')} still unlogged.`}
                status="missed"
                variant="warn"
                to="/screentime"
              />
            )}
          </section>

          <section className="dash__stats dash__stats--single">
            <StatCard
              label="Gym streak"
              value={<><span className="dash__num">{gym}</span> <span className="dash__unit">{gym === 1 ? 'day' : 'days'}</span></>}
              sublabel={restLeft === 0
                ? 'budget reached this week'
                : `${restLeft} rest ${restLeft === 1 ? 'day' : 'days'} left this week`}
              best={bestGym > 0 ? bestGym : undefined}
              variant="glow"
            />
          </section>

          <section className="card">
            <div className="card__header">
              <h2>Gym — last 30 days</h2>
              <span className="muted">amber = kept</span>
            </div>
            <DotCalendar
              entries={entries}
              label="Gym last 30 days"
              filled={(e) => e?.gym_actual === 'yes'}
            />
          </section>

          <section className="card">
            <div className="card__header">
              <h2>Sleep quality</h2>
              <span className="muted">last 14 nights</span>
            </div>
            <SleepTrendChart entries={entries} />
          </section>

          <section className="card">
            <div className="card__header">
              <h2>Social time</h2>
            </div>
            <SocialFrequency entries={entries} />
          </section>

          {screenTrend && <ScreenTimeTrendCard trend={screenTrend} />}
        </>
      )}

      {showCtxEditor && (
        <ContextPeriodModal
          periods={periods ?? []}
          onClose={() => setShowCtxEditor(false)}
          onChanged={(next) => setPeriods(next)}
        />
      )}
    </main>
  )
}

// Kept in lockstep with the worker's dueMorning/dueEvening smart-skips
// (worker/src/index.ts) — deep_work fields retired July 2026.
function isMorningDone(e: Entry | null): boolean {
  return !!e && !!e.bedtime && !!e.wake_time && e.sleep_quality !== null && e.gym_intention !== null
}

function isEveningDone(e: Entry | null): boolean {
  return !!e && e.gym_actual !== null && e.day_quality !== null
}

function morningSummary(e: Entry): string {
  const parts: string[] = []
  if (e.sleep_quality) parts.push(`${'★'.repeat(e.sleep_quality)} sleep`)
  if (e.gym_intention) parts.push(`gym ${e.gym_intention}`)
  return parts.join(' · ')
}

function eveningSummary(e: Entry): string {
  const parts: string[] = []
  if (e.gym_actual) parts.push(`gym ${e.gym_actual}`)
  if (e.day_quality) parts.push(`${'★'.repeat(e.day_quality)} day`)
  if (e.social !== null) parts.push(e.social ? 'social' : 'solo')
  return parts.join(' · ')
}
