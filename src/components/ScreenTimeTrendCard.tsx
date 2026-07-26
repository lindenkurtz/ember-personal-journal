import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { PhoneTimeTrend, formatDuration } from '../lib/screenTime'
import './ScreenTimeTrendCard.css'

interface Props {
  trend: PhoneTimeTrend
}

/**
 * Always-available entry point into /screentime — the weekly nag card on the
 * Dashboard disappears the moment a week has any row, so without this link
 * there's no way back into the entry form once that happens. Doubles as a
 * quick "am I trending up or down" glance: last logged week's average daily
 * phone time vs. the average across every logged week.
 */
export default function ScreenTimeTrendCard({ trend }: Props) {
  const { lastWeekAvgMinutes, overallAvgMinutes, pctChange, weeksLogged, weekStart, weekEnd } = trend
  const maxVal = Math.max(lastWeekAvgMinutes, overallAvgMinutes, 1)
  const barPct = (v: number) => Math.max(4, Math.round((v / maxVal) * 100))
  const rounded = Math.round(Math.abs(pctChange))
  const direction = pctChange > 0.5 ? 'up' : pctChange < -0.5 ? 'down' : 'flat'

  return (
    <Link to="/screentime" className="dash__card sttrend">
      <div className="dash__cardHeader">
        <div>
          <h2>Phone time — daily avg</h2>
          <span className="sttrend__range muted">
            {format(parseISO(weekStart), 'MMM d')} – {format(parseISO(weekEnd), 'MMM d')}
          </span>
        </div>
        <span className="sttrend__arrow" aria-hidden="true">→</span>
      </div>

      <div className="sttrend__bars">
        <div className="sttrend__row">
          <span className="sttrend__label">This week</span>
          <div className="sttrend__track">
            <div
              className="sttrend__fill sttrend__fill--week"
              style={{ width: `${barPct(lastWeekAvgMinutes)}%` }}
            />
          </div>
          <span className="sttrend__value">{formatDuration(Math.round(lastWeekAvgMinutes))}</span>
        </div>
        <div className="sttrend__row">
          <span className="sttrend__label">Your average</span>
          <div className="sttrend__track">
            <div
              className="sttrend__fill sttrend__fill--avg"
              style={{ width: `${barPct(overallAvgMinutes)}%` }}
            />
          </div>
          <span className="sttrend__value">{formatDuration(Math.round(overallAvgMinutes))}</span>
        </div>
      </div>

      <p className="sttrend__delta muted">
        {weeksLogged < 2 || direction === 'flat'
          ? 'Log another week to see a trend.'
          : `${direction === 'up' ? '▲' : '▼'} ${rounded}% ${direction === 'up' ? 'above' : 'below'} your average`}
      </p>
    </Link>
  )
}
