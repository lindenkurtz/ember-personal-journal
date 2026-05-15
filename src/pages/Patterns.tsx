import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getRange, Entry } from '../lib/entries'
import { streamClaude } from '../lib/claude'
import './Patterns.css'

const SYSTEM_PROMPT = [
  "You are a thoughtful, honest journal companion analyzing the user's last 30 days of daily entries.",
  "Write in second person, conversational tone — like a friend who pays attention.",
  "Look for: correlations (sleep ↔ gym, sleep ↔ deep work, social ↔ everything), trends across the month,",
  "consistency gaps between intentions and actuals, and weekday vs weekend patterns.",
  "Be specific — cite actual numbers where they help. Be honest — don't soften real misses.",
  "Don't list bullets unless it's genuinely the clearest format. Prefer 3–5 short paragraphs.",
  "No preamble, no greeting, no sign-off. Don't restate the question."
].join(' ')

export default function Patterns() {
  const [running, setRunning] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [count, setCount] = useState<number | null>(null)

  async function analyze() {
    setRunning(true)
    setText('')
    setError(null)
    try {
      const entries = await getRange(30)
      setCount(entries.length)
      if (entries.length < 3) {
        setError('Not enough days logged yet — analysis works better with a few weeks of entries.')
        setRunning(false)
        return
      }
      await streamClaude(
        {
          system: SYSTEM_PROMPT,
          prompt: buildPrompt(entries),
          max_tokens: 800
        },
        (chunk) => setText((t) => t + chunk)
      )
    } catch (err) {
      console.error(err)
      setError("Couldn't reach the analysis service. Try again in a minute.")
    } finally {
      setRunning(false)
    }
  }

  return (
    <main className="patterns">
      <header className="patterns__header">
        <Link to="/dashboard" className="patterns__back">← back</Link>
        <h1 className="patterns__title">Patterns</h1>
        <p className="muted">An honest read on the last 30 days.</p>
      </header>

      {!text && !running && (
        <div className="patterns__cta">
          <button className="patterns__primary" onClick={analyze} disabled={running}>
            Analyze the last 30 days
          </button>
          <p className="muted patterns__hint">
            Sends a compact summary of your entries to Claude. Nothing is shared elsewhere.
          </p>
        </div>
      )}

      {error && <p className="patterns__error">{error}</p>}

      {(text || running) && (
        <article className={'patterns__reading' + (running ? ' is-streaming' : '')}>
          {text || <span className="muted">Reading {count ?? 30} days…</span>}
          {running && <span className="patterns__caret" aria-hidden="true">▍</span>}
        </article>
      )}

      {text && !running && (
        <div className="patterns__again">
          <button className="patterns__ghost" onClick={analyze}>Run again</button>
        </div>
      )}
    </main>
  )
}

function buildPrompt(entries: Entry[]): string {
  const rows = entries.map((e) => ({
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
    wcode: e.weather_code,
    note: e.note
  }))
  return [
    `Daily entries for the last ${entries.length} days (oldest first):`,
    JSON.stringify(rows),
    "",
    "Field key:",
    "  bed = bedtime, sleep = quality 1–5, gym_i = morning intention, gym_a = actual,",
    "  dw_t = deep work target hours, dw_a = actual hours, soc = had social time,",
    "  hrv = average HRV (ms), rhr = resting heart rate (bpm), steps = daily step count,",
    "  tempF = outside temp at morning check-in (°F), wcode = Open-Meteo WMO weather code,",
    "  note = freetext notes about the day (may include trip-ups, wins, or general context).",
    "",
    "HRV, resting heart rate, steps, and weather are sparsely populated passive signals. Only draw conclusions from these fields when at least 15 non-null values exist in the 30-day window. Always caveat findings based on sparse data. Never treat a missing value as zero. These fields help explain patterns in the primary metrics (gym, deep work, sleep) — they are not goals in themselves.",
    "",
    "Write the analysis."
  ].join('\n')
}
