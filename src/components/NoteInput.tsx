import './NoteInput.css'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel: string
}

export default function NoteInput({ value, onChange, placeholder, ariaLabel }: Props) {
  return (
    <textarea
      className="noteinput"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={4}
    />
  )
}
