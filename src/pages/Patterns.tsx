import { useEffect, useState } from 'react'
import { getRange, Entry } from '../lib/entries'
import { getScreenTimeRange, ScreenTimeRow } from '../lib/screenTime'
import { listContextPeriods, ContextPeriod } from '../lib/contextPeriods'
import { buildCompactRows, contextHeader, FIELD_LEGEND, SPARSE_NOTE } from '../lib/promptData'
import { lastNDays, todayKey } from '../lib/date'
import { streamClaude } from '../lib/claude'
import { holdUpdates } from '../lib/swUpdate'
import PageHeader from '../components/PageHeader'
import './Patterns.css'

const SYSTEM_PROMPT = [
  "You are a thoughtful, honest journal companion analyzing the user's last 30 days of daily entries.",
  "Write in second person, conversational tone — like a friend who pays attention.",
  "Day quality (dq, 1–5) is the PRIMARY TARGET. Focus first on what predicts higher-vs-lower day quality",
  "scores — sleep, gym, focused work, meal timing, social time, screen time, weather, and passive signals.",
  "Also surface: correlations between the inputs, trends across the month, consistency gaps between",
  "intentions and actuals, and weekday vs weekend patterns.",
  "Confound flags (illness, alcohol, sleeping away, travel, late caffeine, deadlines) mark rare but",
  "distorting days — use them to explain outliers and discount those days, never as goals in themselves.",
  "Be specific — cite actual numbers where they help. Be honest — don't soften real misses.",
  "Don't list bullets unless it's genuinely the clearest format. Prefer 3–5 short paragraphs.",
  "No preamble, no greeting, no sign-off. Don't restate the question."
].join(' ')

export default function Patterns() {
  const [running, setRunning] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [count, setCount] = useState<number | null>(null)

  // A reload mid-stream would drop the analysis; it isn't stored anywhere.
  useEffect(() => (running ? holdUpdates() : undefined), [running])

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
      // Screen time and context periods ride along as predictors/grouping;
      // either failing must not block the analysis.
      const [screen, periods] = await Promise.all([
        getScreenTimeRange(lastNDays(30)[0], todayKey()).catch(() => [] as ScreenTimeRow[]),
        listContextPeriods().catch(() => [] as ContextPeriod[])
      ])
      await streamClaude(
        {
          system: SYSTEM_PROMPT,
          prompt: buildPrompt(entries, screen, periods),
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
    <main className="page patterns">
      <PageHeader title="Patterns" subtitle="An honest read on the last 30 days." />

      {!text && !running && (
        <div className="card patterns__cta">
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

function buildPrompt(entries: Entry[], screen: ScreenTimeRow[], periods: ContextPeriod[]): string {
  const rows = buildCompactRows(entries, new Map(screen.map((r) => [r.date, r])), { notes: true })
  const sections = [
    `Daily entries for the last ${entries.length} days (oldest first):`,
    JSON.stringify(rows),
    ''
  ]
  const ctx = contextHeader(periods)
  if (ctx) sections.push(ctx, '')
  sections.push(FIELD_LEGEND, '', SPARSE_NOTE, '', 'Write the analysis.')
  return sections.join('\n')
}
