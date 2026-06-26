import { useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { format, parseISO } from 'date-fns'
import type { FinanceAccount, FinanceBalance, NetWorthSnapshot } from '../../../shared/finance/types'
import { money } from '../../lib/finance/format'

interface Props {
  snapshots: NetWorthSnapshot[]
  accounts: FinanceAccount[]
  balances: FinanceBalance[] // full per-account history, oldest first
}

export default function NetWorthChart({ snapshots, accounts, balances }: Props) {
  const [selected, setSelected] = useState<string>('net_worth')

  // Only offer accounts that actually have balance history to plot.
  const selectable = accounts.filter((a) => balances.some((b) => b.account_id === a.account_id))
  const account = accounts.find((a) => a.account_id === selected)
  const label = selected === 'net_worth' ? 'Net worth' : account?.name ?? 'Balance'

  const series = selected === 'net_worth'
    ? snapshots.map((s) => ({ as_of: s.as_of, value: s.net_worth }))
    : balances.filter((b) => b.account_id === selected).map((b) => ({ as_of: b.as_of, value: b.balance }))
  const data = series.map((p) => ({ day: format(parseISO(p.as_of), 'MMM d'), value: p.value }))

  return (
    <div className="finance__chartWrap">
      <select
        className="finance__sel finance__chartSel"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="net_worth">Total net worth</option>
        {selectable.map((a) => (
          <option key={a.account_id} value={a.account_id}>
            {a.name}{a.mask ? ` ··${a.mask}` : ''}
          </option>
        ))}
      </select>

      {data.length < 2 ? (
        <p className="finance__empty">
          {selected === 'net_worth'
            ? 'Net worth is charted once you have at least two sync snapshots.'
            : 'Not enough history for this account yet — it charts after a second sync.'}
        </p>
      ) : (
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
              formatter={(v: number) => [money(v), label]}
            />
            <Line type="monotone" dataKey="value" stroke="var(--amber)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
