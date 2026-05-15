import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import QuestionCard from '../components/QuestionCard'
import ProgressDots from '../components/ProgressDots'
import PillGroup from '../components/PillGroup'
import NumberStepper from '../components/NumberStepper'
import NoteInput from '../components/NoteInput'
import { getEntry, upsertEntry, GymChoice, Entry } from '../lib/entries'
import { todayKey, prettyDay } from '../lib/date'
import '../pages/Morning.css' // share the journal layout/buttons

const GYM_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' }
] as const

const SOCIAL_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' }
] as const

interface DraftEvening {
  gym_actual: GymChoice | null
  deep_work_actual: number
  social: boolean | null
  note: string
}

const QUESTIONS = ['gym', 'deep', 'social', 'note'] as const
type Step = (typeof QUESTIONS)[number]

export default function Evening() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  // `?date=YYYY-MM-DD` lets the dashboard send us back to a missed previous day
  // for a make-up entry. No param → today.
  const targetDate = useMemo(() => {
    const q = params.get('date')
    return q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : todayKey()
  }, [params])
  const isMakeup = targetDate !== todayKey()

  const [step, setStep] = useState<Step>('gym')
  const [draft, setDraft] = useState<DraftEvening>({
    gym_actual: null,
    deep_work_actual: 0,
    social: null,
    note: ''
  })
  const [morning, setMorning] = useState<Entry | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed from the target day's existing row so the user can review/edit rather
  // than re-enter. For makeups, this pulls yesterday's morning intent forward.
  useEffect(() => {
    let cancelled = false
    getEntry(targetDate)
      .then((e) => {
        if (cancelled || !e) return
        setMorning(e)
        setDraft((d) => ({
          gym_actual: e.gym_actual ?? e.gym_intention ?? d.gym_actual,
          deep_work_actual: e.deep_work_actual ?? d.deep_work_actual,
          social: e.social ?? d.social,
          note: e.note ?? d.note
        }))
      })
      .catch(() => { /* ignore — let user fill manually */ })
    return () => { cancelled = true }
  }, [targetDate])

  const idx = QUESTIONS.indexOf(step)
  const canAdvance = isValid(step, draft)
  const isLast = step === 'note'

  function next() {
    if (!canAdvance) return
    if (!isLast) setStep(QUESTIONS[idx + 1])
    else void submit()
  }
  function back() {
    // First question's back button returns to the dashboard so the user is
    // never trapped inside the check-in flow.
    if (idx === 0) navigate('/')
    else setStep(QUESTIONS[idx - 1])
  }

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      await upsertEntry({
        date: targetDate,
        gym_actual: draft.gym_actual,
        deep_work_actual: draft.deep_work_actual,
        social: draft.social,
        note: draft.note.trim() || null
      })
      navigate('/')
    } catch (err) {
      console.error(err)
      setError("Couldn't save just now. Try again in a moment.")
      setSubmitting(false)
    }
  }

  const headerLabel = isMakeup
    ? `${format(parseISO(targetDate), 'EEE, MMM d')} · evening (make up)`
    : `${prettyDay()} · evening`

  return (
    <main className="morning">
      <header className="morning__header">
        <span className="morning__date">{headerLabel}</span>
        <ProgressDots total={QUESTIONS.length} current={idx} />
      </header>

      <div className="morning__stage">
        <AnimatePresence mode="wait">
          <StepView
            step={step}
            draft={draft}
            setDraft={setDraft}
            morningTarget={morning?.deep_work_target ?? null}
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
            {isLast ? (submitting ? 'Saving…' : 'Save & close out') : 'Next'}
          </button>
        </div>
      </footer>
    </main>
  )
}

function StepView({
  step,
  draft,
  setDraft,
  morningTarget
}: {
  step: Step
  draft: DraftEvening
  setDraft: (d: DraftEvening) => void
  morningTarget: number | null
}) {
  if (step === 'gym') {
    return (
      <QuestionCard
        stepKey="gym"
        question="Did you gym?"
        hint="Confirm or update your morning answer."
      >
        <PillGroup
          ariaLabel="Gym actual"
          options={GYM_OPTIONS}
          value={draft.gym_actual}
          onChange={(v) => setDraft({ ...draft, gym_actual: v })}
        />
      </QuestionCard>
    )
  }
  if (step === 'deep') {
    return (
      <QuestionCard
        stepKey="deep"
        question="How much deep work?"
        hint={morningTarget !== null ? `Target was ${morningTarget}h.` : undefined}
      >
        <NumberStepper
          ariaLabel="Deep work actual hours"
          value={draft.deep_work_actual}
          onChange={(v) => setDraft({ ...draft, deep_work_actual: v })}
          min={0}
          max={12}
          step={0.25}
        />
      </QuestionCard>
    )
  }
  if (step === 'social') {
    return (
      <QuestionCard stepKey="social" question="Any social time today?">
        <PillGroup
          ariaLabel="Social"
          options={SOCIAL_OPTIONS}
          value={draft.social === null ? null : draft.social ? 'yes' : 'no'}
          onChange={(v) => setDraft({ ...draft, social: v === 'yes' })}
        />
      </QuestionCard>
    )
  }
  return (
    <QuestionCard
      stepKey="note"
      question="Anything in the way?"
      hint="Optional — what tripped you up or worked well."
    >
      <NoteInput
        ariaLabel="Evening note"
        placeholder="A sentence or two…"
        value={draft.note}
        onChange={(v) => setDraft({ ...draft, note: v })}
      />
    </QuestionCard>
  )
}

function isValid(step: Step, d: DraftEvening): boolean {
  switch (step) {
    case 'gym':
      return d.gym_actual !== null
    case 'deep':
      return d.deep_work_actual >= 0
    case 'social':
      return d.social !== null
    case 'note':
      return true // optional
  }
}
