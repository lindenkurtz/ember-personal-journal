import './NoteInput.css'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel: string
  rows?: number
}

export default function NoteInput({ value, onChange, placeholder, ariaLabel, rows = 4 }: Props) {
  return (
    <textarea
      className="noteinput"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
    />
  )
}
