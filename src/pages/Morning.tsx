import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import QuestionCard from '../components/QuestionCard'
import ProgressDots from '../components/ProgressDots'
import StarRating from '../components/StarRating'
import PillGroup from '../components/PillGroup'
import TimeInput from '../components/TimeInput'
import NumberStepper from '../components/NumberStepper'
import { upsertEntry, getEntry, getRange, GymChoice, Entry } from '../lib/entries'
import { getSettings, updateSettings } from '../lib/settings'
import { callClaude } from '../lib/claude'
import { todayKey, prettyDay } from '../lib/date'
import './Morning.css'

const GYM_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' }
] as const

interface DraftMorning {
  bedtime: string | null
  sleep_quality: number | null
  gym_intention: GymChoice | null
  deep_work_target: number
  deep_work_start: string | null
}

const QUESTIONS = ['sleep', 'rating', 'gym', 'focus'] as const
type Step = (typeof QUESTIONS)[number]

export default function Morning() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('sleep')
  const [draft, setDraft] = useState<DraftMorning>({
    bedtime: null,
    sleep_quality: null,
    gym_intention: null,
    deep_work_target: 3,
    deep_work_start: null
  })
  const [submitting, setSubmitting] = useState(false)
  const [nudge, setNudge] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Prefill from today's row so re-opening a completed check-in lets you edit,
  // not re-enter from scratch.
  useEffect(() => {
    let cancelled = false
    getEntry()
      .then((e) => {
        if (cancelled || !e) return
        setDraft((d) => ({
          bedtime: e.bedtime ?? d.bedtime,
          sleep_quality: e.sleep_quality ?? d.sleep_quality,
          gym_intention: e.gym_intention ?? d.gym_intention,
          deep_work_target: e.deep_work_target ?? d.deep_work_target,
          deep_work_start: e.deep_work_start ?? d.deep_work_start
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
  const isLast = step === 'focus'

  function next() {
    if (!canAdvance) return
    if (!isLast) setStep(QUESTIONS[idx + 1])
    else void submit()
  }
  function back() {
    // On the first question, the back button returns to the dashboard so the
    // user is never stranded in the check-in flow.
    if (idx === 0) navigate('/')
    else setStep(QUESTIONS[idx - 1])
  }

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const date = todayKey()
      await upsertEntry({
        date,
        bedtime: draft.bedtime,
        sleep_quality: draft.sleep_quality,
        gym_intention: draft.gym_intention,
        deep_work_target: draft.deep_work_target,
        deep_work_start: draft.deep_work_start
      })
      // Pull last 14 days to ground the nudge in recent context.
      const recent = await getRange(14).catch(() => [] as Entry[])
      const text = await callClaude({
        max_tokens: 180,
        system:
          "You write a single 1–2 sentence morning nudge for the user based on patterns " +
          "in their recent daily journal. Be warm but honest, specific, and concrete — " +
          "no preamble, no greeting, no sign-off. Speak to the user directly. " +
          "If you notice a pattern (e.g. low sleep correlated with skipped gym, or " +
          "deep work consistently undershooting target), name it gently. " +
          "Only reference facts present in the data you're given; never fabricate " +
          "numbers, durations, or units.",
        prompt: buildNudgePrompt(recent, { date, ...draft })
      })
      setNudge(text.trim())
    } catch (err) {
      console.error(err)
      setError("Couldn't reach the API — your entry was saved. Continuing.")
      // Still consider the morning done; dashboard is the next destination.
      setTimeout(() => navigate('/'), 1200)
    } finally {
      setSubmitting(false)
    }
  }

  // After nudge is shown, give the user time to read before moving on.
  function continueToDashboard() {
    navigate('/')
  }

  return (
    <main className="morning">
      <header className="morning__header">
        <span className="morning__date">{prettyDay()}</span>
        <ProgressDots total={QUESTIONS.length} current={idx} />
      </header>

      <div className="morning__stage">
        <AnimatePresence mode="wait">
          {nudge ? (
            <motion.section
              key="nudge"
              className="nudge"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="nudge__glow" aria-hidden="true" />
              <p className="nudge__label">a note for today</p>
              <p className="nudge__text">{nudge}</p>
              <button className="morning__primary" onClick={continueToDashboard}>
                Begin the day →
              </button>
            </motion.section>
          ) : submitting ? (
            <motion.div
              key="loading"
              className="ember-glow"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              <div className="ember-glow__ring" />
              <p className="muted">Reading the last two weeks…</p>
            </motion.div>
          ) : (
            <Question step={step} draft={draft} setDraft={setDraft} />
          )}
        </AnimatePresence>
      </div>

      {!nudge && !submitting && (
        <footer className="morning__footer">
          {error && <p className="morning__error">{error}</p>}
          <div className="morning__nav">
            <button
              className="morning__ghost"
              onClick={back}
              aria-label={idx === 0 ? 'Back to dashboard' : 'Previous question'}
            >
              ←
            </button>
            <button
              className="morning__primary"
              onClick={next}
              disabled={!canAdvance}
            >
              {isLast ? 'Begin the day' : 'Next'}
            </button>
          </div>
        </footer>
      )}
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
  if (step === 'sleep') {
    return (
      <QuestionCard
        stepKey="sleep"
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
  if (step === 'gym') {
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
  return (
    <QuestionCard
      stepKey="focus"
      question="How much deep work?"
      hint="Set a target and when you'll start."
    >
      <NumberStepper
        ariaLabel="Deep work target in hours"
        value={draft.deep_work_target}
        onChange={(v) =>
          setDraft({
            ...draft,
            deep_work_target: v,
            deep_work_start: v === 0 ? null : draft.deep_work_start
          })
        }
        min={0}
        max={10}
        step={0.5}
      />
      {draft.deep_work_target > 0 && (
        <TimeInput
          ariaLabel="Planned start time"
          value={draft.deep_work_start}
          onChange={(v) => setDraft({ ...draft, deep_work_start: v })}
        />
      )}
    </QuestionCard>
  )
}

function isValid(step: Step, d: DraftMorning): boolean {
  switch (step) {
    case 'sleep':
      return !!d.bedtime
    case 'rating':
      return d.sleep_quality !== null
    case 'gym':
      return d.gym_intention !== null
    case 'focus':
      return d.deep_work_target === 0
        ? true
        : d.deep_work_target > 0 && !!d.deep_work_start
  }
}

function buildNudgePrompt(
  recent: Entry[],
  today: { date: string } & DraftMorning
): string {
  // Compact JSON keeps the token cost small while preserving all signal.
  // The schema header is critical: without it Claude has hallucinated
  // "hours of sleep" from the 1–5 `sleep` quality rating.
  const history = recent.map((e) => ({
    d: e.date,
    bed: e.bedtime,
    sleep: e.sleep_quality,
    gym_i: e.gym_intention,
    gym_a: e.gym_actual,
    dw_t: e.deep_work_target,
    dw_a: e.deep_work_actual,
    soc: e.social,
    hrv: e.hrv_avg,
    rhr: e.resting_hr,
    steps: e.steps,
    tempF: e.weather_temp_f,
    wcode: e.weather_code
  }))
  return [
    "Schema (all fields nullable; null means the user didn't log it):",
    "- d: date (YYYY-MM-DD)",
    "- bed: bedtime as 'HH:MM' local time the user went to sleep the night before. NOT a duration.",
    "- sleep: self-reported sleep quality, integer 1–5 stars. NOT hours of sleep — sleep duration is not tracked.",
    "- gym_i: morning intention for the gym — 'yes' | 'no'",
    "- gym_a: evening report of whether they actually went — 'yes' | 'no'",
    "- dw_t: deep-work target in hours (decimal, e.g. 2.5)",
    "- dw_a: deep-work actually completed in hours",
    "- soc: boolean — did they have meaningful social interaction that day",
    "- hrv: average heart rate variability in ms (passive, sparsely populated, often null)",
    "- rhr: resting heart rate in bpm (passive, sparsely populated, often null)",
    "- steps: total step count for the day (passive, sparsely populated, often null)",
    "- tempF: current outside temperature in °F at the morning check-in (passive, sparsely populated, often null)",
    "- wcode: Open-Meteo WMO weather code (passive, sparsely populated, often null)",
    "",
    "HRV, resting heart rate, steps, and weather are sparsely populated passive signals. Only draw conclusions from these fields when at least 15 non-null values exist in the 30-day window. Always caveat findings based on sparse data. Never treat a missing value as zero. These fields help explain patterns in the primary metrics (gym, deep work, sleep) — they are not goals in themselves.",
    "",
    "Recent 14 days (most recent last):",
    JSON.stringify(history),
    "",
    "This morning's check-in (same field meanings as above, full names):",
    JSON.stringify({
      date: today.date,
      bedtime: today.bedtime,
      sleep_quality: today.sleep_quality,
      gym_intention: today.gym_intention,
      deep_work_target: today.deep_work_target,
      deep_work_start: today.deep_work_start
    }),
    "",
    "Write the nudge. Do not invent fields or units that are not in the schema. Never reference hours of sleep — that data does not exist."
  ].join('\n')
}
