import { ReactNode } from 'react'
import './ToggleChipGroup.css'

export interface ToggleChipOption<T extends string> {
  value: T
  label: string
  hint?: string
  /** Follow-up control shown inside the chip while it is on. Belongs to this chip
   * rather than to the group, so it stays attached to the choice that revealed it
   * instead of adding a second block below the list. */
  expansion?: ReactNode
}

interface Props<T extends string> {
  selected: readonly T[]
  onToggle: (v: T) => void
  options: readonly ToggleChipOption<T>[]
  ariaLabel: string
}

/** Multi-select sibling of PillGroup: independent on/off chips, compact enough
 * to show six at once without scrolling. The chip is a <div> wrapping the toggle
 * button rather than being the button itself — an `expansion` contains its own
 * controls, and a <button> inside a <button> is invalid HTML. */
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
          <div key={opt.value} className={'chips__chip' + (on ? ' is-on' : '')}>
            <button
              type="button"
              aria-pressed={on}
              className="chips__toggle"
              onClick={() => onToggle(opt.value)}
            >
              <span className="chips__label">{opt.label}</span>
              {opt.hint && <span className="chips__hint">{opt.hint}</span>}
            </button>
            {on && opt.expansion && <div className="chips__expansion">{opt.expansion}</div>}
          </div>
        )
      })}
    </div>
  )
}
