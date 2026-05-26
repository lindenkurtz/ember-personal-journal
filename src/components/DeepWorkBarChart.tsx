import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts'
import { Entry } from '../lib/entries'
import { lastNDays } from '../lib/date'
import { format, parseISO } from 'date-fns'

interface Props {
  entries: Entry[]
  days?: number // default 7
}

/** Weekly deep-work hours: actual vs target, color-coded amber if hit, terracotta if short. */
export default function DeepWorkBarChart({ entries, days = 7 }: Props) {
  const byDate = new Map(entries.map((e) => [e.date, e]))
  const data = lastNDays(days).map((d) => {
    const e = byDate.get(d)
    return {
      day: format(parseISO(d), 'EEE'),
      actual: e?.deep_work_actual ?? 0,
      target: e?.deep_work_target ?? 0,
      hit: (e?.deep_work_actual ?? 0) >= (e?.deep_work_target ?? Infinity)
    }
  })
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid stroke="rgba(245,237,216,0.06)" vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} stroke="var(--muted)" style={{ fontSize: 12 }} />
        <YAxis tickLine={false} axisLine={false} stroke="var(--muted)" style={{ fontSize: 12 }} width={32} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: 'rgba(232,168,124,0.08)' }}
          contentStyle={{
            background: 'var(--card)',
            border: '1px solid var(--hairline)',
            borderRadius: 12,
            color: 'var(--text)'
          }}
          formatter={(v: number, name: string) => [`${v}h`, name]}
        />
        <Bar dataKey="actual" radius={[6, 6, 0, 0]} name="actual">
          {data.map((d, i) => (
            <Cell key={i} fill={d.hit ? 'var(--amber)' : 'var(--terracotta)'} fillOpacity={d.actual ? 1 : 0.15} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
