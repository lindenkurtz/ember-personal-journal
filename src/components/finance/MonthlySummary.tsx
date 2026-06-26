import type { CashFlow, SavingsRates } from '../../lib/finance/analytics'
import { money, percent } from '../../lib/finance/format'

interface Props {
  monthLabel: string
  flow: CashFlow
  prior: CashFlow
  savings: SavingsRates
  subsTotal: number
  pendingReview: number
  onPrev: () => void
  onNext: () => void
  canNext: boolean
}

/** Condensed top-of-page panel built for the ~15-minute monthly check-in. */
export default function MonthlySummary({ monthLabel, flow, prior, savings, subsTotal, pendingReview, onPrev, onNext, canNext }: Props) {
  const delta = flow.net - prior.net
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
          <div className="finance__netLabel">Net cash flow</div>
          <div className={'finance__netValue' + (flow.net < 0 ? ' is-neg' : '')}>{money(flow.net, { signed: true })}</div>
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
        <div className="finance__tile">
          <span className="finance__tileLabel">Subscriptions</span>
          <span className="finance__tileNum">{money(subsTotal)}</span>
        </div>
        <div className="finance__tile">
          <span className="finance__tileLabel">Short-term savings</span>
          <span className="finance__tileNum">{money(savings.shortTerm)}</span>
          <span className="finance__tileSub">{percent(savings.shortTermRate)} of income</span>
        </div>
        <div className="finance__tile">
          <span className="finance__tileLabel">Long-term savings</span>
          <span className="finance__tileNum">{money(savings.longTerm)}</span>
          <span className="finance__tileSub">{percent(savings.longTermRate)} of income</span>
        </div>
        <div className="finance__tile">
          <span className="finance__tileLabel">Retirement</span>
          <span className="finance__tileNum">{money(savings.retirement)}</span>
          <span className="finance__tileSub">{percent(savings.retirementRate)} of income</span>
        </div>
      </div>
    </section>
  )
}
