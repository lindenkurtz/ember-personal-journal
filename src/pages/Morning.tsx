import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import QuestionCard from '../components/QuestionCard'
import ProgressDots from '../components/ProgressDots'
import StarRating from '../components/StarRating'
import PillGroup from '../components/PillGroup'
import TimeInput from '../components/TimeInput'
import { upsertEntry, getEntry, getRange, GymChoice, Entry } from '../lib/entries'
import { getScreenTimeRange, ScreenTimeRow } from '../lib/screenTime'
import { listContextPeriods, ContextPeriod } from '../lib/contextPeriods'
import { buildCompactRows, contextHeader, FIELD_LEGEND, SPARSE_NOTE } from '../lib/promptData'
import { getSettings, updateSettings } from '../lib/settings'
import { callClaude } from '../lib/claude'
import { todayKey, prettyDay, lastNDays } from '../lib/date'
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
      // Pull last 14 days to ground the nudge in recent context. Screen time
      // and context periods ride along; either failing must not block the nudge.
      const [recent, screen, periods] = await Promise.all([
        getRange(14).catch(() => [] as Entry[]),
        getScreenTimeRange(lastNDays(14)[0], todayKey()).catch(() => [] as ScreenTimeRow[]),
        listContextPeriods().catch(() => [] as ContextPeriod[])
      ])
      const text = await callClaude({
        max_tokens: 180,
        system:
          "You write a single 1–2 sentence morning nudge for the user based on patterns " +
          "in their recent daily journal. Be warm but honest, specific, and concrete — " +
          "no preamble, no greeting, no sign-off. Speak to the user directly. " +
          "If you notice a pattern (e.g. low sleep correlated with skipped gym, or " +
          "late caffeine showing up before poorly-rated nights), name it gently. " +
          "Only reference facts present in the data you're given; never fabricate " +
          "numbers, durations, or units.",
        prompt: buildNudgePrompt(recent, screen, periods, { date, ...draft })
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

function buildNudgePrompt(
  recent: Entry[],
  screen: ScreenTimeRow[],
  periods: ContextPeriod[],
  today: { date: string } & DraftMorning
): string {
  // Compact JSON keeps the token cost small while preserving all signal.
  // The schema legend is critical: without it Claude has hallucinated
  // "hours of sleep" from the 1–5 `sleep` quality rating.
  const history = buildCompactRows(recent, new Map(screen.map((r) => [r.date, r])))
  const sections = [FIELD_LEGEND, '', SPARSE_NOTE, '']
  const ctx = contextHeader(periods)
  if (ctx) sections.push(ctx, '')
  sections.push(
    'Recent 14 days (most recent last):',
    JSON.stringify(history),
    '',
    "This morning's check-in (same field meanings as above, full names):",
    JSON.stringify({
      date: today.date,
      bedtime: today.bedtime,
      wake_time: today.wake_time,
      sleep_quality: today.sleep_quality,
      gym_intention: today.gym_intention
    }),
    '',
    'Write the nudge. Do not invent fields or units that are not in the schema. Only reference hours of sleep if `sleep_h` is non-null for the relevant day.'
  )
  return sections.join('\n')
}
