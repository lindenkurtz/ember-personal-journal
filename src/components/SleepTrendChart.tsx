import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Entry } from '../lib/entries'
import { lastNDays } from '../lib/date'
import { format, parseISO } from 'date-fns'

interface Props {
  entries: Entry[]
  days?: number // default 14
}

export default function SleepTrendChart({ entries, days = 14 }: Props) {
  const byDate = new Map(entries.map((e) => [e.date, e]))
  const data = lastNDays(days).map((d) => ({
    day: format(parseISO(d), 'MMM d'),
    quality: byDate.get(d)?.sleep_quality ?? null
  }))
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid stroke="rgba(245,237,216,0.06)" vertical={false} />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          stroke="var(--muted)"
          style={{ fontSize: 11 }}
          interval={Math.max(0, Math.floor(days / 7) - 1)}
        />
        <YAxis
          domain={[1, 5]}
          ticks={[1, 2, 3, 4, 5]}
          tickLine={false}
          axisLine={false}
          stroke="var(--muted)"
          style={{ fontSize: 12 }}
          width={32}
        />
        <Tooltip
          cursor={{ stroke: 'var(--amber-soft)' }}
          contentStyle={{
            background: 'var(--card)',
            border: '1px solid var(--hairline)',
            borderRadius: 12,
            color: 'var(--text)'
          }}
        />
        <Line
          type="monotone"
          dataKey="quality"
          stroke="var(--amber)"
          strokeWidth={2.5}
          dot={{ r: 3, fill: 'var(--amber)', strokeWidth: 0 }}
          activeDot={{ r: 5, fill: 'var(--terracotta)' }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
