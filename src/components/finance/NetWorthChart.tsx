import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { format, parseISO } from 'date-fns'
import type { NetWorthSnapshot } from '../../../shared/finance/types'
import { money } from '../../lib/finance/format'

export default function NetWorthChart({ snapshots }: { snapshots: NetWorthSnapshot[] }) {
  if (snapshots.length < 2) {
    return <p className="finance__empty">Net worth is charted once you have at least two sync snapshots.</p>
  }
  const data = snapshots.map((s) => ({ day: format(parseISO(s.as_of), 'MMM d'), value: s.net_worth }))
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="rgba(245,237,216,0.06)" vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} stroke="var(--muted)" style={{ fontSize: 12 }} minTickGap={24} />
        <YAxis
          tickLine={false}
          axisLine={false}
          stroke="var(--muted)"
          style={{ fontSize: 12 }}
          width={56}
          tickFormatter={(v: number) => money(v)}
        />
        <Tooltip
          contentStyle={{ background: 'var(--card)', border: '1px solid var(--hairline)', borderRadius: 12, color: 'var(--text)' }}
          formatter={(v: number) => [money(v), 'Net worth']}
        />
        <Line type="monotone" dataKey="value" stroke="var(--amber)" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
