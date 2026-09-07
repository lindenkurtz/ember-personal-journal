import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import QuestionCard from '../components/QuestionCard'
import ProgressDots from '../components/ProgressDots'
import PillGroup from '../components/PillGroup'
import NoteInput from '../components/NoteInput'
import StarRating from '../components/StarRating'
import TimeInput from '../components/TimeInput'
import ToggleChipGroup, { ToggleChipOption } from '../components/ToggleChipGroup'
import {
  getEntry,
  upsertEntry,
  GymChoice,
  FocusedWork,
  SocialLevel,
  SickLevel,
  EntryPatch,
  ConfoundKey,
  CONFOUND_KEYS,
  CONFOUND_LABELS,
  TRACKING_V2_START,
  FOCUSED_WORK_START,
  SOCIAL_LEVEL_START,
  SICK_LEVEL_START
} from '../lib/entries'
import { todayKey, prettyDay } from '../lib/date'
import { holdUpdates } from '../lib/swUpdate'
import '../pages/Morning.css' // share the journal layout/buttons

const GYM_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' }
] as const

// Pre-SOCIAL_LEVEL_START days only; a make-up for one of those is still yes/no.
const SOCIAL_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' }
] as const

const SOCIAL_LEVEL_OPTIONS = [
  { value: '0', label: 'None' },
  { value: '1', label: 'Passing' },
  { value: '2', label: 'A real hang' },
  { value: '3', label: 'Most of the day' }
] as const
type SocialLevelKey = (typeof SOCIAL_LEVEL_OPTIONS)[number]['value']

// Persistent (not a tooltip), same as FOCUSED_DEFINITION: the boundaries have to
// mean the same thing in month six as they did in month one.
const SOCIAL_LEVEL_DEFINITION =
  'None · Passing = roommates around, someone in class ' +
  '· A real hang = deliberate time with someone · Most of the day.'

const FOCUSED_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'light', label: 'Light (<1h)' },
  { value: 'solid', label: 'Solid (1–3h)' },
  { value: 'deep', label: 'Deep (3h+)' }
] as const

// Persistent (not a tooltip) so scoring stays consistent over months.
const FOCUSED_DEFINITION =
  'Focused, cognitively demanding self-directed work: studying, problem sets, ' +
  'research, applications, side projects. Not lecture, email, or routine job tasks.'

const CONFOUND_OPTIONS: readonly ToggleChipOption<ConfoundKey>[] = [
  { value: 'sick', label: CONFOUND_LABELS.sick },
  { value: 'alcohol', label: CONFOUND_LABELS.alcohol },
  {
    value: 'slept_away',
    label: CONFOUND_LABELS.slept_away,
    hint: 'Last night, in any bed but your own — including all nights of a trip, not just the first.'
  },
  { value: 'travel_day', label: CONFOUND_LABELS.travel_day, hint: '3+ hours in transit today.' },
  { value: 'caffeine_late', label: CONFOUND_LABELS.caffeine_late, hint: 'Caffeine after ~2pm.' },
  {
    value: 'deadline_pressure',
    label: CONFOUND_LABELS.deadline_pressure,
    hint: 'Exam or major deadline within 48h.'
  }
]

// Revealed under the Sick chip rather than given its own step: a normal day should
// still cost one tap, and this flow is long enough already.
const SICK_LEVEL_OPTIONS = [
  { value: '1', label: 'Light' },
  { value: '2', label: 'Major' }
] as const
type SickLevelKey = (typeof SICK_LEVEL_OPTIONS)[number]['value']

// Persistent, same reason as FOCUSED_DEFINITION: the boundary has to mean the same
// thing in month six as it did in month one.
const SICK_LEVEL_DEFINITION =
  'Light = off, but the day still worked · Major = the day was lost to it.'

interface DraftEvening {
  gym_actual: GymChoice | null
  focused_work: FocusedWork | null
  last_meal_start_time: string | null
  confounds: Record<ConfoundKey, boolean>
  sick_level: SickLevel | null
  social: boolean | null
  social_level: SocialLevel | null
  day_quality: number | null
  note: string
}

type Step = 'gym' | 'focused' | 'meal' | 'confounds' | 'social' | 'day_quality' | 'note'

const NO_CONFOUNDS = Object.fromEntries(
  CONFOUND_KEYS.map((k) => [k, false])
) as Record<ConfoundKey, boolean>

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

  // Steps are keyed to the TARGET date, not today: a make-up for a pre-v2 day
  // must not ask (or save) the meal/confound questions — writing explicit
  // `false` flags onto a day from before they were tracked would destroy the
  // null = "untracked" distinction. Same gate for focused_work before 8/15.
  const questions = useMemo<Step[]>(() => {
    const q: Step[] = ['gym']
    if (targetDate >= FOCUSED_WORK_START) q.push('focused')
    if (targetDate >= TRACKING_V2_START) q.push('meal', 'confounds')
    q.push('social', 'day_quality', 'note')
    return q
  }, [targetDate])

  const [step, setStep] = useState<Step>('gym')
  const [draft, setDraft] = useState<DraftEvening>({
    gym_actual: null,
    focused_work: null,
    last_meal_start_time: null,
    confounds: { ...NO_CONFOUNDS },
    sick_level: null,
    social: null,
    social_level: null,
    day_quality: null,
    note: ''
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The draft lives in memory only, and an auto-update reload would discard it.
  useEffect(holdUpdates, [])

  // Seed from the target day's existing row so the user can review/edit rather
  // than re-enter. For makeups, this pulls yesterday's morning intent forward.
  useEffect(() => {
    let cancelled = false
    getEntry(targetDate)
      .then((e) => {
        if (cancelled || !e) return
        const confounds = Object.fromEntries(
          CONFOUND_KEYS.map((k) => [k, e[k] ?? false])
        ) as Record<ConfoundKey, boolean>
        // A light day saves `sick` as false, so the chip has to come from the level
        // wherever one exists — reading the boolean would show a logged light day as
        // not sick and silently clear it on the next save.
        if (e.sick_level != null) confounds.sick = e.sick_level > 0
        setDraft((d) => ({
          gym_actual: e.gym_actual ?? e.gym_intention ?? d.gym_actual,
          focused_work: e.focused_work ?? d.focused_work,
          last_meal_start_time: e.last_meal_start_time ?? d.last_meal_start_time,
          confounds,
          // Never derived from the boolean, for the same reason as social_level.
          sick_level: e.sick_level ?? d.sick_level,
          social: e.social ?? d.social,
          // Never derived from the boolean: old rows were never rated at this
          // resolution and a seeded level would be an invented observation.
          social_level: e.social_level ?? d.social_level,
          day_quality: e.day_quality ?? d.day_quality,
          note: e.note ?? d.note
        }))
      })
      .catch(() => { /* ignore — let user fill manually */ })
    return () => { cancelled = true }
  }, [targetDate])

  const idx = questions.indexOf(step)
  const canAdvance = isValid(step, draft, targetDate)
  const isLast = idx === questions.length - 1

  function next() {
    if (!canAdvance) return
    if (!isLast) setStep(questions[idx + 1])
    else void submit()
  }
  function back() {
    // First question's back button returns to the dashboard so the user is
    // never trapped inside the check-in flow.
    if (idx === 0) navigate('/')
    else setStep(questions[idx - 1])
  }

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const patch: EntryPatch = {
        date: targetDate,
        gym_actual: draft.gym_actual,
        day_quality: draft.day_quality,
        note: draft.note.trim() || null
      }
      if (targetDate >= SOCIAL_LEVEL_START) {
        patch.social_level = draft.social_level
        // Keep the legacy binary continuous across the cutover so everything
        // reading `social` — History, the prompts, the export's backward-compatible
        // column — keeps working mid-transition without a special case.
        patch.social = draft.social_level === null ? null : draft.social_level > 0
      } else {
        patch.social = draft.social
      }
      if (targetDate >= TRACKING_V2_START) {
        patch.last_meal_start_time = draft.last_meal_start_time
        // Explicit true/false for every flag: tapping past the screen means
        // "tracked, nothing unusual", which the analysis must be able to tell
        // apart from the pre-v2 nulls.
        for (const k of CONFOUND_KEYS) patch[k] = draft.confounds[k]
      }
      if (targetDate >= SICK_LEVEL_START) {
        // Chip off is an explicit 0 - "tracked, not sick" - for the same reason the
        // flags write explicit false.
        const level = draft.confounds.sick ? draft.sick_level : 0
        patch.sick_level = level
        // Deliberately overrides the flag loop above: `sick` goes on meaning a major
        // day, exactly what it meant before the split, so the pre-cutover series
        // stays comparable and light days never inflate it.
        patch.sick = level === null ? null : level >= 2
      }
      if (targetDate >= FOCUSED_WORK_START) {
        patch.focused_work = draft.focused_work
      }
      await upsertEntry(patch)
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
        <ProgressDots total={questions.length} current={idx} />
      </header>

      <div className="morning__stage">
        <AnimatePresence mode="wait">
          <StepView step={step} draft={draft} setDraft={setDraft} targetDate={targetDate} />
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
  targetDate
}: {
  step: Step
  draft: DraftEvening
  setDraft: (d: DraftEvening) => void
  targetDate: string
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
  if (step === 'focused') {
    return (
      <QuestionCard
        stepKey="focused"
        question="Focused work today?"
        hint={FOCUSED_DEFINITION}
      >
        <PillGroup
          ariaLabel="Focused work"
          options={FOCUSED_OPTIONS}
          value={draft.focused_work}
          onChange={(v) => setDraft({ ...draft, focused_work: v })}
        />
      </QuestionCard>
    )
  }
  if (step === 'meal') {
    return (
      <QuestionCard
        stepKey="meal"
        question="When did you start your last meal?"
        hint="The time you started eating — not when you finished."
      >
        <TimeInput
          ariaLabel="Last meal start time"
          value={draft.last_meal_start_time}
          onChange={(v) => setDraft({ ...draft, last_meal_start_time: v })}
        />
      </QuestionCard>
    )
  }
  if (step === 'confounds') {
    return (
      <QuestionCard
        stepKey="confounds"
        question="Anything unusual?"
        hint="Tap any that apply — tapping none is a normal day."
      >
        <ToggleChipGroup
          ariaLabel="Confounding events"
          options={CONFOUND_OPTIONS}
          selected={CONFOUND_KEYS.filter((k) => draft.confounds[k])}
          onToggle={(k) =>
            setDraft({
              ...draft,
              confounds: { ...draft.confounds, [k]: !draft.confounds[k] }
            })
          }
        />
        {targetDate >= SICK_LEVEL_START && draft.confounds.sick && (
          <div className="morning__subq">
            <p className="morning__subqHint">{SICK_LEVEL_DEFINITION}</p>
            <PillGroup
              ariaLabel="Sickness level"
              options={SICK_LEVEL_OPTIONS}
              value={draft.sick_level ? (String(draft.sick_level) as SickLevelKey) : null}
              onChange={(v) => setDraft({ ...draft, sick_level: Number(v) as SickLevel })}
            />
          </div>
        )}
      </QuestionCard>
    )
  }
  if (step === 'social') {
    // A make-up for a day before the cutover keeps the boolean question — that
    // day was never rated at this resolution and can't be given a level now.
    if (targetDate < SOCIAL_LEVEL_START) {
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
        stepKey="social"
        question="How much social time today?"
        hint={SOCIAL_LEVEL_DEFINITION}
      >
        <PillGroup
          ariaLabel="Social level"
          options={SOCIAL_LEVEL_OPTIONS}
          value={
            draft.social_level === null
              ? null
              : (String(draft.social_level) as SocialLevelKey)
          }
          onChange={(v) => setDraft({ ...draft, social_level: Number(v) as SocialLevel })}
        />
      </QuestionCard>
    )
  }
  if (step === 'day_quality') {
    return (
      <QuestionCard stepKey="day_quality" question="How was today overall?">
        <StarRating
          value={draft.day_quality}
          onChange={(v) => setDraft({ ...draft, day_quality: v })}
        />
      </QuestionCard>
    )
  }
  return (
    <QuestionCard
      stepKey="note"
      question="Anything to note?"
      hint="Optional — what tripped you up, what worked well, or anything else worth remembering."
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

function isValid(step: Step, d: DraftEvening, targetDate: string): boolean {
  switch (step) {
    case 'gym':
      return d.gym_actual !== null
    case 'focused':
      return d.focused_work !== null
    case 'meal':
      return !!d.last_meal_start_time
    case 'confounds':
      // No selection is still a normal day. The one gate is the revealed level: a
      // Sick chip with nothing picked would save as 0 and read back as not sick.
      return targetDate >= SICK_LEVEL_START && d.confounds.sick
        ? d.sick_level === 1 || d.sick_level === 2
        : true
    case 'social':
      return targetDate >= SOCIAL_LEVEL_START ? d.social_level !== null : d.social !== null
    case 'day_quality':
      return d.day_quality !== null
    case 'note':
      return true // optional
  }
}
