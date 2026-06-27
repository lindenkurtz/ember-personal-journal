import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import type { CashFlow, IncomeSlice, SavingsRates } from '../../lib/finance/analytics'
import { MISC_INCOME } from '../../lib/finance/analytics'
import { money } from '../../lib/finance/format'

interface Props {
  flow: CashFlow
  income: IncomeSlice[]
  savings: SavingsRates
}

// Warm-gold ramp assigned by rank; Misc is always the neutral grey. Cycles if
// there are ever more distinct sources than ramp colors (there won't be in
// practice — a handful of payers at most).
const INCOME_RAMP = ['var(--income-1)', 'var(--income-2)', 'var(--income-3)', 'var(--income-4)', 'var(--income-5)']

function incomeColor(source: string, rank: number): string {
  return source === MISC_INCOME ? 'var(--income-misc)' : INCOME_RAMP[rank % INCOME_RAMP.length]
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

/**
 * Two bars: income, and where it went. The income bar stacks each payer source
 * (discovered from the data, not enumerated here); the "Out" bar stacks spending
 * with the three savings buckets, so the gap up to the income bar reads as the
 * unallocated buffer at a glance and the tooltip carries the per-source and
 * per-bucket breakdown. Savings here are transfers (excluded from `expenses`),
 * so there's no double-counting.
 */
export default function CashFlowChart({ flow, income, savings }: Props) {
  const savingsTotal = savings.shortTerm + savings.longTerm + savings.retirement
  if (flow.income === 0 && flow.expenses === 0 && savingsTotal === 0) {
    return <p className="finance__empty">No income or spending recorded this month yet.</p>
  }
  // Each source becomes its own dataKey, present only in the Income row. The top
  // of each stack (last income source, Retirement on the Out side) is rounded.
  const incomeRow: Record<string, number | string> = { label: 'Income', Spending: 0, 'Short-term': 0, 'Long-term': 0, Retirement: 0 }
  const outRow: Record<string, number | string> = { label: 'Out', Spending: flow.expenses, 'Short-term': savings.shortTerm, 'Long-term': savings.longTerm, Retirement: savings.retirement }
  for (const s of income) {
    incomeRow[s.source] = s.total
    outRow[s.source] = 0
  }
  const data = [incomeRow, outRow]
  return (
    <ResponsiveContainer width="100%" height={190}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid stroke="rgba(245,237,216,0.06)" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="var(--muted)" style={{ fontSize: 12 }} />
        <YAxis tickLine={false} axisLine={false} stroke="var(--muted)" style={{ fontSize: 12 }} width={56} tickFormatter={(v: number) => money(v)} />
        <Tooltip cursor={{ fill: 'rgba(232,168,124,0.08)' }} content={<CashTooltip />} />
        {income.map((s, i) => (
          <Bar
            key={s.source}
            dataKey={s.source}
            stackId="a"
            fill={incomeColor(s.source, i)}
            radius={i === income.length - 1 ? [6, 6, 0, 0] : undefined}
          />
        ))}
        <Bar dataKey="Spending" stackId="a" fill="var(--terracotta)" />
        <Bar dataKey="Short-term" stackId="a" fill="var(--sage)" />
        <Bar dataKey="Long-term" stackId="a" fill="var(--sage-deep)" />
        <Bar dataKey="Retirement" stackId="a" fill="var(--sage-light)" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
