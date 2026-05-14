import { useState } from 'react'
import './StarRating.css'

interface Props {
  value: number | null
  onChange: (v: number | null) => void
  max?: number
}

export default function StarRating({ value, onChange, max = 5 }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const active = hover ?? value ?? 0
  return (
    <div className="stars" onMouseLeave={() => setHover(null)} role="radiogroup" aria-label="Sleep quality">
      {Array.from({ length: max }, (_, i) => {
        const n = i + 1
        const filled = n <= active
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} of ${max}`}
            className={'stars__btn' + (filled ? ' is-filled' : '')}
            onMouseEnter={() => setHover(n)}
            // Tap same star again to clear.
            onClick={() => onChange(value === n ? null : n)}
          >
            <Star filled={filled} />
          </button>
        )
      })}
    </div>
  )
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true">
      <path
        d="M12 2.6l2.95 6.27 6.85.7-5.16 4.7 1.46 6.83L12 17.7l-6.1 3.4 1.46-6.83L2.2 9.57l6.85-.7L12 2.6z"
        fill={filled ? 'var(--amber)' : 'none'}
        stroke={filled ? 'var(--amber)' : 'var(--muted)'}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}
