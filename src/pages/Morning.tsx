import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import QuestionCard from '../components/QuestionCard'
import ProgressDots from '../components/ProgressDots'
import StarRating from '../components/StarRating'
import PillGroup from '../components/PillGroup'
import TimeInput from '../components/TimeInput'
import { upsertEntry, getEntry, GymChoice } from '../lib/entries'
import { getSettings, updateSettings } from '../lib/settings'
import { todayKey, prettyDay } from '../lib/date'
import { holdUpdates } from '../lib/swUpdate'
import './Morning.css'

const GYM_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' }
] as const

interface DraftMorning {
  bedtime: string | null
  wake_time: string | null
  sleep_quality: number | null
  gym_intention: GymChoice | null
}

const QUESTIONS = ['bedtime', 'wake', 'rating', 'gym'] as const
type Step = (typeof QUESTIONS)[number]

export default function Morning() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('bedtime')
  const [draft, setDraft] = useState<DraftMorning>({
    bedtime: null,
    wake_time: null,
    sleep_quality: null,
    gym_intention: null
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The draft lives in memory only, and an auto-update reload would discard it.
  useEffect(holdUpdates, [])

  // Prefill from today's row so re-opening a completed check-in lets you edit,
  // not re-enter from scratch.
  useEffect(() => {
    let cancelled = false
    getEntry()
      .then((e) => {
        if (cancelled || !e) return
        setDraft((d) => ({
          bedtime: e.bedtime ?? d.bedtime,
          wake_time: e.wake_time ?? d.wake_time,
          sleep_quality: e.sleep_quality ?? d.sleep_quality,
          gym_intention: e.gym_intention ?? d.gym_intention
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
  const isLast = step === 'gym'

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
        sleep_quality: draft.sleep_quality,
        gym_intention: draft.gym_intention
      })
      navigate('/')
    } catch (err) {
      console.error(err)
      setError("Couldn't save your entry. Check your connection and try again.")
      setSubmitting(false)
    }
  }

  return (
    <main className="morning">
      <header className="morning__header">
        <span className="morning__date">{prettyDay()}</span>
        <ProgressDots total={QUESTIONS.length} current={idx} />
      </header>

      <div className="morning__stage">
        <AnimatePresence mode="wait">
          <Question step={step} draft={draft} setDraft={setDraft} />
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

function Question({
  step,
  draft,
  setDraft
}: {
  step: Step
  draft: DraftMorning
  setDraft: (d: DraftMorning) => void
}) {
  if (step === 'bedtime') {
    return (
      <QuestionCard
        stepKey="bedtime"
        question="When did you go to bed?"
        hint="Last night's bedtime — a rough estimate is fine."
      >
        <TimeInput
          ariaLabel="Last night's bedtime"
          value={draft.bedtime}
          onChange={(v) => setDraft({ ...draft, bedtime: v })}
        />
      </QuestionCard>
    )
  }
  if (step === 'wake') {
    return (
      <QuestionCard
        stepKey="wake"
        question="When did you wake up?"
        hint="This morning's wake time — close enough is fine."
      >
        <TimeInput
          ariaLabel="This morning's wake time"
          value={draft.wake_time}
          onChange={(v) => setDraft({ ...draft, wake_time: v })}
        />
      </QuestionCard>
    )
  }
  if (step === 'rating') {
    return (
      <QuestionCard stepKey="rating" question="How did you sleep?">
        <StarRating
          value={draft.sleep_quality}
          onChange={(v) => setDraft({ ...draft, sleep_quality: v })}
        />
      </QuestionCard>
    )
  }
  return (
    <QuestionCard stepKey="gym" question="Gym today?">
      <PillGroup
        ariaLabel="Gym intention"
        options={GYM_OPTIONS}
        value={draft.gym_intention}
        onChange={(v) => setDraft({ ...draft, gym_intention: v })}
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
    case 'gym':
      return d.gym_intention !== null
  }
}
