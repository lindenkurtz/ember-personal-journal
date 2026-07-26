import { useEffect, useRef, useState } from 'react'
import './DurationWheelPicker.css'

const ROW_HEIGHT = 40
const VISIBLE_ROWS = 5
const PAD_ROWS = Math.floor(VISIBLE_ROWS / 2)

interface WheelProps {
  count: number
  index: number
  unitLabel: string
  ariaLabel: string
  onChange: (i: number) => void
}

function Wheel({ count, index, unitLabel, ariaLabel, onChange }: WheelProps) {
  const ref = useRef<HTMLDivElement>(null)
  const settleTimer = useRef<number | undefined>(undefined)
  const [liveIndex, setLiveIndex] = useState(index)

  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = index * ROW_HEIGHT
    // Only run on mount — subsequent index changes come from this wheel's
    // own scroll, so re-seeding here would fight the user's gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleScroll() {
    const el = ref.current
    if (!el) return
    const nearest = Math.round(el.scrollTop / ROW_HEIGHT)
    setLiveIndex(Math.min(count - 1, Math.max(0, nearest)))
    window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => {
      onChange(Math.min(count - 1, Math.max(0, nearest)))
    }, 120)
  }

  function selectRow(i: number) {
    ref.current?.scrollTo({ top: i * ROW_HEIGHT, behavior: 'smooth' })
  }

  return (
    <div className="durwheel__col">
      <div className="durwheel__highlight" />
      <div
        ref={ref}
        className="durwheel__scroll"
        role="listbox"
        aria-label={ariaLabel}
        style={{ paddingTop: PAD_ROWS * ROW_HEIGHT, paddingBottom: PAD_ROWS * ROW_HEIGHT }}
        onScroll={handleScroll}
      >
        {Array.from({ length: count }, (_, i) => {
          const selected = i === liveIndex
          const dist = Math.abs(i - liveIndex)
          return (
            <div
              key={i}
              className="durwheel__row"
              style={{ height: ROW_HEIGHT, opacity: Math.max(0.18, 1 - dist * 0.32) }}
              role="option"
              aria-selected={selected}
              onClick={() => selectRow(i)}
            >
              <span className={`durwheel__num${selected ? ' durwheel__num--selected' : ''}`}>
                {i}{selected ? ` ${unitLabel}` : ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface Props {
  title: string
  initialMinutes: number
  maxHours?: number
  onCancel: () => void
  onConfirm: (minutes: number) => void
}

/** Bottom-sheet duration entry: two scroll-snap wheels, hours and minutes. */
export default function DurationWheelPicker({ title, initialMinutes, maxHours = 23, onCancel, onConfirm }: Props) {
  const [hours, setHours] = useState(() => Math.min(maxHours, Math.floor(initialMinutes / 60)))
  const [minutes, setMinutes] = useState(() => initialMinutes % 60)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="durwheel" role="dialog" aria-modal="true" aria-label={title}>
      <div className="durwheel__backdrop" onClick={onCancel} />
      <div className="durwheel__sheet">
        <p className="durwheel__title">{title}</p>
        <div className="durwheel__wheels">
          <Wheel count={maxHours + 1} index={hours} unitLabel="hours" ariaLabel="Hours" onChange={setHours} />
          <Wheel count={60} index={minutes} unitLabel="min" ariaLabel="Minutes" onChange={setMinutes} />
        </div>
        <div className="durwheel__actions">
          <button type="button" className="durwheel__cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="durwheel__done" onClick={() => onConfirm(hours * 60 + minutes)}>Done</button>
        </div>
      </div>
    </div>
  )
}
