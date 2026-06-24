import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import type { CashFlow, SavingsRates } from '../../lib/finance/analytics'
import { money } from '../../lib/finance/format'

interface Props {
  flow: CashFlow
  savings: SavingsRates
}

interface TipEntry { name: string; value: number; color: string }

function CashTooltip({ active, payload, label }: { active?: boolean; payload?: TipEntry[]; label?: string }) {
  const rows = (payload ?? []).filter((p) => p.value > 0)
  if (!active || !rows.length) return null
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--hairline)', borderRadius: 12, padding: '8px 10px', color: 'var(--text)', fontSize: 12 }}>
      <div style={{ color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      {rows.map((r) => (
        <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <span style={{ color: r.color }}>{r.name}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(r.value)}</span>
        </div>
      ))}
    </div>
  )
}

function LegendDot({ color, children }: { color: string; children: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: color }} />
      {children}
    </span>
  )
}

/**
 * Two bars: income, and where it went. The "Out" bar stacks spending with the
 * three savings buckets, so the gap up to the income bar reads as the
 * unallocated buffer at a glance and the tooltip carries the per-bucket
 * breakdown. Savings here are transfers (excluded from `expenses`), so there's
 * no double-counting.
 */
export default function CashFlowChart({ flow, savings }: Props) {
  const savingsTotal = savings.shortTerm + savings.longTerm + savings.retirement
  if (flow.income === 0 && flow.expenses === 0 && savingsTotal === 0) {
    return <p className="finance__empty">No income or spending recorded this month yet.</p>
  }
  const data = [
    { label: 'Income', Income: flow.income, Spending: 0, 'Short-term': 0, 'Long-term': 0, Retirement: 0 },
    { label: 'Out', Income: 0, Spending: flow.expenses, 'Short-term': savings.shortTerm, 'Long-term': savings.longTerm, Retirement: savings.retirement }
  ]
  return (
    <>
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid stroke="rgba(245,237,216,0.06)" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="var(--muted)" style={{ fontSize: 12 }} />
          <YAxis tickLine={false} axisLine={false} stroke="var(--muted)" style={{ fontSize: 12 }} width={56} tickFormatter={(v: number) => money(v)} />
          <Tooltip cursor={{ fill: 'rgba(232,168,124,0.08)' }} content={<CashTooltip />} />
          <Bar dataKey="Income" stackId="a" fill="var(--amber)" radius={[6, 6, 0, 0]} />
          <Bar dataKey="Spending" stackId="a" fill="var(--terracotta)" />
          <Bar dataKey="Short-term" stackId="a" fill="var(--sage)" />
          <Bar dataKey="Long-term" stackId="a" fill="var(--sage-deep)" />
          <Bar dataKey="Retirement" stackId="a" fill="var(--sage-light)" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div className="finance__chartLegend">
        <LegendDot color="var(--amber)">Income</LegendDot>
        <LegendDot color="var(--terracotta)">Spending</LegendDot>
        <LegendDot color="var(--sage)">Savings</LegendDot>
      </div>
    </>
  )
}
