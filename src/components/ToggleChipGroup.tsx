import './ToggleChipGroup.css'

export interface ToggleChipOption<T extends string> {
  value: T
  label: string
  hint?: string
}

interface Props<T extends string> {
  selected: readonly T[]
  onToggle: (v: T) => void
  options: readonly ToggleChipOption<T>[]
  ariaLabel: string
}

/** Multi-select sibling of PillGroup: independent on/off chips, compact enough
 * to show six at once without scrolling. */
export default function ToggleChipGroup<T extends string>({
  selected,
  onToggle,
  options,
  ariaLabel
}: Props<T>) {
  return (
    <div className="chips" role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const on = selected.includes(opt.value)
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={on}
            className={'chips__chip' + (on ? ' is-on' : '')}
            onClick={() => onToggle(opt.value)}
          >
            <span className="chips__label">{opt.label}</span>
            {opt.hint && <span className="chips__hint">{opt.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}
