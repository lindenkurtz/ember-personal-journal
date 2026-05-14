import { Entry } from '../lib/entries'
import { lastNDays } from '../lib/date'
import { format, parseISO } from 'date-fns'
import './SocialFrequency.css'

interface Props {
  entries: Entry[]
  days?: number // default 7
}

/** Strip of 7 day labels, amber dot under days where social=true. */
export default function SocialFrequency({ entries, days = 7 }: Props) {
  const byDate = new Map(entries.map((e) => [e.date, e]))
  const data = lastNDays(days).map((d) => ({
    day: format(parseISO(d), 'EEEEE'), // single-letter day
    social: byDate.get(d)?.social === true,
    key: d
  }))
  const count = data.filter((d) => d.social).length
  return (
    <div className="social">
      <div className="social__row">
        {data.map((d) => (
          <div key={d.key} className="social__cell">
            <span className="social__day">{d.day}</span>
            <span className={'social__dot' + (d.social ? ' is-on' : '')} />
          </div>
        ))}
      </div>
      <div className="social__count">{count} {count === 1 ? 'day' : 'days'} this week</div>
    </div>
  )
}
