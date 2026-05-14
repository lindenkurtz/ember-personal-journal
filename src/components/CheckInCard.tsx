import { useNavigate } from 'react-router-dom'
import './CheckInCard.css'

interface Props {
  title: string
  /** Either a short summary line shown on the right ("Logged" / "Pending") or undefined. */
  status: 'done' | 'pending' | 'missed'
  /** Optional one-line preview shown beneath the title (e.g., "Slept 4★ · gym yes"). */
  summary?: string
  to: string
  /** Visual emphasis. `cta` is the brighter amber card used for items needing action. */
  variant?: 'default' | 'cta' | 'warn'
}

export default function CheckInCard({ title, status, summary, to, variant = 'default' }: Props) {
  const navigate = useNavigate()
  return (
    <button
      className={`checkincard checkincard--${variant} checkincard--${status}`}
      onClick={() => navigate(to)}
    >
      <div className="checkincard__main">
        <span className="checkincard__title">{title}</span>
        {summary && <span className="checkincard__summary">{summary}</span>}
      </div>
      <div className="checkincard__status" aria-hidden="true">
        {status === 'done' ? (
          <span className="checkincard__check">
            <Check />
            <span>Logged</span>
          </span>
        ) : status === 'missed' ? (
          <span className="checkincard__pill">Make up</span>
        ) : (
          <span className="checkincard__arrow">→</span>
        )}
      </div>
    </button>
  )
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
