import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts'
import type { CashFlow } from '../../lib/finance/analytics'
import { money } from '../../lib/finance/format'

export default function CashFlowChart({ flow }: { flow: CashFlow }) {
  if (flow.income === 0 && flow.expenses === 0) {
    return <p className="finance__empty">No income or spending recorded this month yet.</p>
  }
  const data = [
    { label: 'Income', value: flow.income, fill: 'var(--amber)' },
    { label: 'Expenses', value: flow.expenses, fill: 'var(--terracotta)' }
  ]
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="rgba(245,237,216,0.06)" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="var(--muted)" style={{ fontSize: 12 }} />
        <YAxis tickLine={false} axisLine={false} stroke="var(--muted)" style={{ fontSize: 12 }} width={56} tickFormatter={(v: number) => money(v)} />
        <Tooltip
          cursor={{ fill: 'rgba(232,168,124,0.08)' }}
          contentStyle={{ background: 'var(--card)', border: '1px solid var(--hairline)', borderRadius: 12, color: 'var(--text)' }}
          formatter={(v: number) => [money(v)]}
        />
        <Bar dataKey="value" radius={[6, 6, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
