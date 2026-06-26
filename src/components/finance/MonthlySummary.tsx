import { useState } from 'react'
import type { CashFlow, SavingsRates } from '../../lib/finance/analytics'
import { money, percent } from '../../lib/finance/format'

export interface SubItem { name: string; amount: number }

interface Props {
  monthLabel: string
  flow: CashFlow
  prior: CashFlow
  savings: SavingsRates
  subItems: SubItem[]
  pendingReview: number
  onPrev: () => void
  onNext: () => void
  canNext: boolean
}

/** Condensed top-of-page panel built for the ~15-minute monthly check-in. */
export default function MonthlySummary({ monthLabel, flow, prior, savings, subItems, pendingReview, onPrev, onNext, canNext }: Props) {
  const [showSubs, setShowSubs] = useState(false)
  const delta = flow.net - prior.net
  const subsTotal = subItems.reduce((s, x) => s + Math.abs(x.amount), 0)
  const savedTotal = savings.shortTerm + savings.longTerm + savings.retirement
  const savedRate = flow.income > 0 ? savedTotal / flow.income : null
  return (
    <section className="finance__summary">
      <div className="finance__summaryHead">
        <div className="finance__monthNav">
          <button className="finance__navBtn" onClick={onPrev} aria-label="Previous month">‹</button>
          <h2>{monthLabel}</h2>
          <button className="finance__navBtn" onClick={onNext} disabled={!canNext} aria-label="Next month">›</button>
        </div>
        {pendingReview > 0 && <span className="finance__badge">{pendingReview} to review</span>}
      </div>

      <div className="finance__netRow">
        <div>
          <div className="finance__netLabel">Cash flow</div>
          <div className={'finance__netValue' + (flow.net < 0 ? ' is-neg' : '')}>{money(flow.net, { signed: true })}</div>
          <div className="finance__netHint">income − spending</div>
        </div>
        <div className="finance__netDelta">
          <span className="finance__netLabel">vs last month</span>
          <span className={delta < 0 ? 'is-neg' : 'is-pos'}>{money(delta, { signed: true })}</span>
        </div>
      </div>

      <div className="finance__tiles">
        <div className="finance__tile">
          <span className="finance__tileLabel">Income</span>
          <span className="finance__tileNum">{money(flow.income)}</span>
        </div>
        <div className="finance__tile">
          <span className="finance__tileLabel">Spending</span>
          <span className="finance__tileNum">{money(flow.expenses)}</span>
        </div>
        <button
          type="button"
          className={'finance__tile finance__tile--btn' + (showSubs ? ' is-open' : '')}
          onClick={() => subItems.length && setShowSubs((v) => !v)}
          disabled={subItems.length === 0}
        >
          <span className="finance__tileLabel">Subscriptions{subItems.length ? ` · ${subItems.length}` : ''}</span>
          <span className="finance__tileNum">{money(subsTotal)}</span>
          {subItems.length > 0 && <span className="finance__tileSub">{showSubs ? 'hide' : 'tap to see'}</span>}
        </button>
        <div className="finance__tile">
          <span className="finance__tileLabel">Saved</span>
          <span className="finance__tileNum">{money(savedTotal)}</span>
          <span className="finance__tileSub">{percent(savedRate)} of income</span>
        </div>
      </div>

      {showSubs && subItems.length > 0 && (
        <div className="finance__subList">
          {subItems.map((s, i) => (
            <div className="finance__subRow" key={i}>
              <span className="finance__subName">{s.name}</span>
              <span className="finance__subAmt">{money(Math.abs(s.amount))}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
