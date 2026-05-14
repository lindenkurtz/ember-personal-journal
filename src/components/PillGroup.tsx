import './PillGroup.css'

export interface PillOption<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  value: T | null
  onChange: (v: T) => void
  options: readonly PillOption<T>[]
  ariaLabel: string
}

export default function PillGroup<T extends string>({ value, onChange, options, ariaLabel }: Props<T>) {
  return (
    <div className="pills" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => {
        const selected = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={'pills__pill' + (selected ? ' is-selected' : '')}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
