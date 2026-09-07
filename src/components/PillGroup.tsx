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
  /** Smaller, always side-by-side. For a follow-up choice nested inside another
   * control, where a full-height stacked pill would blow the step past the fold. */
  variant?: 'default' | 'compact'
}

export default function PillGroup<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  variant = 'default'
}: Props<T>) {
  return (
    <div
      className={'pills' + (variant === 'compact' ? ' pills--compact' : '')}
      role="radiogroup"
      aria-label={ariaLabel}
    >
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
