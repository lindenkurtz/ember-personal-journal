import './TimeInput.css'

interface Props {
  value: string | null
  onChange: (v: string) => void
  ariaLabel: string
}

/** Themed wrapper around the native <input type="time">. */
export default function TimeInput({ value, onChange, ariaLabel }: Props) {
  return (
    <input
      type="time"
      aria-label={ariaLabel}
      className="timeinput"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
