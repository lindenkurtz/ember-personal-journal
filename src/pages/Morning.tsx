import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import QuestionCard from '../components/QuestionCard'
import ProgressDots from '../components/ProgressDots'
import StarRating from '../components/StarRating'
import TimeInput from '../components/TimeInput'
import { upsertEntry, getEntry, getRange } from '../lib/entries'
import { getSettings, updateSettings } from '../lib/settings'
import { todayKey, prettyDay, medianClockTime } from '../lib/date'
import { holdUpdates } from '../lib/swUpdate'
import './Morning.css'

// Window the bed/wake pre-fill is the median of. Two weeks follows a schedule
// change within days without letting one odd night move the suggestion.
const PREFILL_DAYS = 14
// Bedtimes before noon are after-midnight, the same pivot the export's
// sleep-duration math uses.
const BEDTIME_WRAP_HOUR = 12

interface DraftMorning {
  bedtime: string | null
  wake_time: string | null
  sleep_quality: number | null
}

/** Which times currently hold the untouched suggestion, so the hint can say so. */
interface Prefilled {
  bedtime: boolean
  wake_time: boolean
}

const QUESTIONS = ['bedtime', 'wake', 'rating'] as const
type Step = (typeof QUESTIONS)[number]

export default function Morning() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('bedtime')
  const [draft, setDraft] = useState<DraftMorning>({
    bedtime: null,
    wake_time: null,
    sleep_quality: null
  })
  const [prefilled, setPrefilled] = useState<Prefilled>({ bedtime: false, wake_time: false })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The draft lives in memory only, and an auto-update reload would discard it.
  useEffect(holdUpdates, [])

  // Prefill from today's row so re-opening a completed check-in lets you edit,
  // not re-enter from scratch. A time today's row doesn't have yet starts at the
  // recent median, so a typical night is a confirm rather than a picker spin.
  useEffect(() => {
    let cancelled = false
    const today = todayKey()
    Promise.all([getEntry(today), getRange(PREFILL_DAYS + 1).catch(() => [])])
      .then(([e, recent]) => {
        if (cancelled) return
        const past = recent.filter((r) => r.date !== today)
        const typicalBed = medianClockTime(
          past.flatMap((r) => (r.bedtime ? [r.bedtime.slice(0, 5)] : [])),
          BEDTIME_WRAP_HOUR
        )
        const typicalWake = medianClockTime(
          past.flatMap((r) => (r.wake_time ? [r.wake_time.slice(0, 5)] : []))
        )
        const bedtime = e?.bedtime ?? typicalBed
        const wake_time = e?.wake_time ?? typicalWake
        setPrefilled({
          bedtime: !e?.bedtime && !!typicalBed,
          wake_time: !e?.wake_time && !!typicalWake
        })
        setDraft((d) => ({
          bedtime: bedtime ?? d.bedtime,
          wake_time: wake_time ?? d.wake_time,
          sleep_quality: e?.sleep_quality ?? d.sleep_quality
        }))
      })
      .catch(() => { /* offline / unconfigured — let the user fill manually */ })
    return () => { cancelled = true }
  }, [])

  // Silent passive-context capture: best-effort lat/lon for the cron Worker's
  // weather lookup. We deliberately avoid calling getCurrentPosition unless
  // (a) we have no cached coords AND (b) the permission is already granted
  // — otherwise iOS standalone PWAs re-prompt every session. The Settings
  // page's "Detect automatically" button is the one explicit place that
  // can trigger a new prompt.
  useEffect(() => {
    if (!('geolocation' in navigator)) return
    let cancelled = false
    ;(async () => {
      const existing = await getSettings().catch(() => null)
      if (cancelled) return
      if (existing && existing.latitude != null && existing.longitude != null) return

      const perms = navigator.permissions
      if (perms && perms.query) {
        try {
          const status = await perms.query({ name: 'geolocation' as PermissionName })
          if (cancelled) return
          if (status.state !== 'granted') return
        } catch {
          // Older Safari rejects the query — fall through to getCurrentPosition,
          // matching the prior unconditional behavior on those browsers.
        }
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (cancelled) return
          updateSettings({
            latitude: Number(pos.coords.latitude.toFixed(6)),
            longitude: Number(pos.coords.longitude.toFixed(6))
          }).catch(() => { /* silent */ })
        },
        () => { /* denied / unavailable — silent */ },
        { timeout: 10000, maximumAge: 60 * 60 * 1000 }
      )
    })()
    return () => { cancelled = true }
  }, [])

  const idx = QUESTIONS.indexOf(step)
  const canAdvance = isValid(step, draft)
  const isLast = idx === QUESTIONS.length - 1

  function next() {
    if (!canAdvance) return
    if (!isLast) setStep(QUESTIONS[idx + 1])
    else void saveEntry()
  }
  function back() {
    // On the first question, the back button returns to the dashboard so the
    // user is never stranded in the check-in flow.
    if (idx === 0) navigate('/')
    else setStep(QUESTIONS[idx - 1])
  }

  async function saveEntry() {
    setSubmitting(true)
    setError(null)
    try {
      const date = todayKey()
      await upsertEntry({
        date,
        bedtime: draft.bedtime,
        wake_time: draft.wake_time,
        sleep_quality: draft.sleep_quality
      })
      navigate('/')
    } catch (err) {
      console.error(err)
      setError("Couldn't save just now. Try again in a moment.")
      setSubmitting(false)
    }
  }

  return (
    <main className="morning">
      <header className="morning__header">
        <span className="morning__date">{`${prettyDay()} · morning`}</span>
        <ProgressDots total={QUESTIONS.length} current={idx} />
      </header>

      <div className="morning__stage">
        <AnimatePresence mode="wait">
          <StepView
            step={step}
            draft={draft}
            prefilled={prefilled}
            setDraft={setDraft}
            setPrefilled={setPrefilled}
          />
        </AnimatePresence>
      </div>

      <footer className="morning__footer">
        {error && <p className="morning__error">{error}</p>}
        <div className="morning__nav">
          <button
            className="morning__ghost"
            onClick={back}
            disabled={submitting}
            aria-label={idx === 0 ? 'Back to dashboard' : 'Previous question'}
          >
            ←
          </button>
          <button
            className="morning__primary"
            onClick={next}
            disabled={!canAdvance || submitting}
          >
            {isLast ? (submitting ? 'Saving…' : 'Begin the day') : 'Next'}
          </button>
        </div>
      </footer>
    </main>
  )
}

const BED_PREFILL_HINT = 'Filled in from your usual — adjust it if last night was different.'
const WAKE_PREFILL_HINT = 'Filled in from your usual — adjust it if this morning was different.'

function StepView({
  step,
  draft,
  prefilled,
  setDraft,
  setPrefilled
}: {
  step: Step
  draft: DraftMorning
  prefilled: Prefilled
  setDraft: (d: DraftMorning) => void
  setPrefilled: (p: Prefilled) => void
}) {
  if (step === 'bedtime') {
    return (
      <QuestionCard
        stepKey="bedtime"
        question="When did you go to bed?"
        hint={prefilled.bedtime ? BED_PREFILL_HINT : "Last night's bedtime — a rough estimate is fine."}
      >
        <TimeInput
          ariaLabel="Last night's bedtime"
          value={draft.bedtime}
          onChange={(v) => {
            setDraft({ ...draft, bedtime: v })
            setPrefilled({ ...prefilled, bedtime: false })
          }}
        />
      </QuestionCard>
    )
  }
  if (step === 'wake') {
    return (
      <QuestionCard
        stepKey="wake"
        question="When did you wake up?"
        hint={prefilled.wake_time ? WAKE_PREFILL_HINT : "This morning's wake time — close enough is fine."}
      >
        <TimeInput
          ariaLabel="This morning's wake time"
          value={draft.wake_time}
          onChange={(v) => {
            setDraft({ ...draft, wake_time: v })
            setPrefilled({ ...prefilled, wake_time: false })
          }}
        />
      </QuestionCard>
    )
  }
  return (
    <QuestionCard stepKey="rating" question="How did you sleep?">
      <StarRating
        value={draft.sleep_quality}
        onChange={(v) => setDraft({ ...draft, sleep_quality: v })}
      />
    </QuestionCard>
  )
}

function isValid(step: Step, d: DraftMorning): boolean {
  switch (step) {
    case 'bedtime':
      return !!d.bedtime
    case 'wake':
      return !!d.wake_time
    case 'rating':
      return d.sleep_quality !== null
  }
}
