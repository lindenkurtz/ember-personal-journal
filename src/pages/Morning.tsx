import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import QuestionCard from '../components/QuestionCard'
import ProgressDots from '../components/ProgressDots'
import StarRating from '../components/StarRating'
import PillGroup from '../components/PillGroup'
import { upsertEntry, getEntry, getRange, GymChoice, Entry } from '../lib/entries'
import { getSettings, updateSettings } from '../lib/settings'
import { callClaude } from '../lib/claude'
import { todayKey, prettyDay } from '../lib/date'
import './Morning.css'

const GYM_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' }
] as const

type DeepWorkPlanned = 'yes' | 'no'

interface DraftMorning {
  bedtime: string | null
  wake_time: string | null
  sleep_quality: number | null
  gym_intention: GymChoice | null
  deep_work_planned: DeepWorkPlanned | null
  deep_work_plan_note: string
}

const QUESTIONS = ['bedtime', 'wake', 'rating', 'gym', 'focus'] as const
type Step = (typeof QUESTIONS)[number]

export default function Morning() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('bedtime')
  const [draft, setDraft] = useState<DraftMorning>({
    bedtime: null,
    wake_time: null,
    sleep_quality: null,
    gym_intention: null,
    deep_work_planned: null,
    deep_work_plan_note: ''
  })
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved] = useState(false)
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
          wake_time: e.wake_time ?? d.wake_time,
          sleep_quality: e.sleep_quality ?? d.sleep_quality,
          gym_intention: e.gym_intention ?? d.gym_intention,
          deep_work_planned: (e.deep_work_planned as DeepWorkPlanned | null) ?? d.deep_work_planned,
          deep_work_plan_note: e.deep_work_plan_note ?? d.deep_work_plan_note
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
        gym_intention: draft.gym_intention,
        deep_work_planned: draft.deep_work_planned,
        deep_work_plan_note: draft.deep_work_planned === 'yes' && draft.deep_work_plan_note
          ? draft.deep_work_plan_note
          : null
      })
      setSaved(true)
    } catch (err) {
      console.error(err)
      setError("Couldn't save your entry. Check your connection and try again.")
    } finally {
      setSubmitting(false)
    }
  }

  async function requestNudge() {
    setSubmitting(true)
    setError(null)
    try {
      const date = todayKey()
      // Pull last 14 days to ground the nudge in recent context.
      const recent = await getRange(14).catch(() => [] as Entry[])
      const text = await callClaude({
        max_tokens: 180,
        system:
          "You write a single 1–2 sentence morning nudge for the user based on patterns " +
          "in their recent daily journal. Be warm but honest, specific, and concrete — " +
          "no preamble, no greeting, no sign-off. Speak to the user directly. " +
          "If you notice a pattern (e.g. low sleep correlated with skipped gym, or " +
          "regularly missing deep work sessions), name it gently. " +
          "Only reference facts present in the data you're given; never fabricate " +
          "numbers, durations, or units.",
        prompt: buildNudgePrompt(recent, { date, ...draft })
      })
      setNudge(text.trim())
    } catch (err) {
      console.error(err)
      setError("Couldn't reach the API — your entry was saved. Continuing.")
      // Entry is already saved; bail to dashboard so the user isn't stuck.
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
          ) : saved ? (
            <motion.section
              key="choose"
              className="nudge-choice"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <p className="nudge-choice__title">Want a nudge for today?</p>
              <p className="nudge-choice__sub">
                Reads your last two weeks and writes a 1–2 sentence note.
              </p>
              {error && <p className="morning__error">{error}</p>}
              <div className="nudge-choice__actions">
                <button
                  className="morning__ghost morning__ghost--wide"
                  onClick={continueToDashboard}
                >
                  Skip to dashboard
                </button>
                <button
                  className="morning__primary"
                  onClick={() => void requestNudge()}
                >
                  Write me one →
                </button>
              </div>
            </motion.section>
          ) : (
            <Question step={step} draft={draft} setDraft={setDraft} />
          )}
        </AnimatePresence>
      </div>

      {!nudge && !submitting && !saved && (
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
      question="Deep work today?"
      hint="Will you get a deep work session in?"
    >
      <PillGroup
        ariaLabel="Deep work intention"
        options={GYM_OPTIONS}
        value={draft.deep_work_planned}
        onChange={(v) => setDraft({ ...draft, deep_work_planned: v as DeepWorkPlanned })}
      />
      {draft.deep_work_planned === 'yes' && (
        <input
          type="text"
          className="morning__planNote"
          placeholder="How and when?"
          value={draft.deep_work_plan_note}
          onChange={(e) => setDraft({ ...draft, deep_work_plan_note: e.target.value })}
          aria-label="Deep work plan note"
        />
      )}
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
    case 'focus':
      return d.deep_work_planned !== null
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
    wake: e.wake_time,
    sleep: e.sleep_quality,
    sleep_h: e.sleep_hours,
    dq: e.day_quality,
    gym_i: e.gym_intention,
    gym_a: e.gym_actual,
    dw_p: e.deep_work_planned,
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
    "- wake: wake time as 'HH:MM' local time the user woke up on the row's date. NOT a duration.",
    "- sleep: self-reported sleep quality, integer 1–5 stars. Subjective rating.",
    "- sleep_h: objective sleep duration in hours from Apple Watch (passive, sparsely populated, often null). Complements `sleep` — `sleep` is the user's subjective rating, `sleep_h` is measured duration.",
    "- dq: self-reported day quality, integer 1–5 stars (logged in the evening, so often null for today).",
    "- gym_i: morning intention for the gym — 'yes' | 'no'",
    "- gym_a: evening report of whether they actually went — 'yes' | 'no'",
    "- dw_p: morning intention for deep work — 'yes' | 'no'",
    "- dw_a: deep-work actually completed in hours (logged in the evening)",
    "- soc: boolean — did they have meaningful social interaction that day",
    "- hrv: average heart rate variability in ms (passive, sparsely populated, often null)",
    "- rhr: resting heart rate in bpm (passive, sparsely populated, often null)",
    "- steps: total step count for the day (passive, sparsely populated, often null)",
    "- tempF: current outside temperature in °F at the morning check-in (passive, sparsely populated, often null)",
    "- wcode: Open-Meteo WMO weather code (passive, sparsely populated, often null)",
    "",
    "HRV, resting heart rate, steps, sleep_h, and weather are sparsely populated passive signals. Only draw conclusions from these fields when at least 15 non-null values exist in the 30-day window. Always caveat findings based on sparse data. Never treat a missing value as zero. These fields help explain patterns in the primary metrics (gym, deep work, sleep) — they are not goals in themselves.",
    "",
    "Recent 14 days (most recent last):",
    JSON.stringify(history),
    "",
    "This morning's check-in (same field meanings as above, full names):",
    JSON.stringify({
      date: today.date,
      bedtime: today.bedtime,
      wake_time: today.wake_time,
      sleep_quality: today.sleep_quality,
      gym_intention: today.gym_intention,
      deep_work_planned: today.deep_work_planned
    }),
    "",
    "Write the nudge. Do not invent fields or units that are not in the schema. Only reference hours of sleep if `sleep_h` is non-null for the relevant day."
  ].join('\n')
}
