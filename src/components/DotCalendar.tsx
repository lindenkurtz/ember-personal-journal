import { Entry } from '../lib/entries'
import { lastNDays } from '../lib/date'
import './DotCalendar.css'

interface Props {
  /** Number of trailing days to show. Defaults to 30. */
  days?: number
  entries: Entry[]
  /** Predicate determines whether the day's dot is "filled". */
  filled: (e: Entry | undefined) => boolean
  /** Optional accessible label like "Gym last 30 days". */
  label?: string
}

export default function DotCalendar({ days = 30, entries, filled, label }: Props) {
  const byDate = new Map(entries.map((e) => [e.date, e]))
  const all = lastNDays(days)
  return (
    <div className="dotcal" aria-label={label}>
      {all.map((d) => {
        const e = byDate.get(d)
        const on = filled(e)
        return <span key={d} className={'dotcal__dot' + (on ? ' is-on' : '')} title={d} />
      })}
    </div>
  )
}
