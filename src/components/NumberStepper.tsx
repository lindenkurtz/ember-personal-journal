import './NumberStepper.css'

interface Props {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  ariaLabel: string
}

/** Big visible value flanked by − / + buttons. Used for deep work target hours. */
export default function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 12,
  step = 0.5,
  unit = 'h',
  ariaLabel
}: Props) {
  const clamp = (n: number) => Math.min(max, Math.max(min, +n.toFixed(1)))
  return (
    <div className="stepper" aria-label={ariaLabel}>
      <button
        type="button"
        className="stepper__btn"
        aria-label="decrease"
        onClick={() => onChange(clamp(value - step))}
        disabled={value <= min}
      >
        −
      </button>
      <div className="stepper__value">
        <span className="stepper__num">{value}</span>
        <span className="stepper__unit">{unit}</span>
      </div>
      <button
        type="button"
        className="stepper__btn"
        aria-label="increase"
        onClick={() => onChange(clamp(value + step))}
        disabled={value >= max}
      >
        +
      </button>
    </div>
  )
}
