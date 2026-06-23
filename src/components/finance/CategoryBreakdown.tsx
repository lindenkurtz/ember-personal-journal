import type { Category } from '../../../shared/finance/types'
import { CATEGORY_LABELS } from '../../../shared/finance/categories'
import type { CategorySlice } from '../../lib/finance/analytics'
import { money } from '../../lib/finance/format'

interface Props {
  current: CategorySlice[]
  averages: Map<Category, number> // 3-month rolling average per category
}

/**
 * Spending by category, current month vs 3-month average. Subscriptions is
 * always pinned in even at $0. Degrades gracefully when little data exists —
 * empty buckets simply don't render (important since Apple Card variety may
 * be sparse).
 */
export default function CategoryBreakdown({ current, averages }: Props) {
  const byCat = new Map(current.map((c) => [c.category, c.total]))
  if (!byCat.has('subscriptions')) byCat.set('subscriptions', 0)

  const rows = [...byCat.entries()]
    .map(([category, total]) => ({ category, total, avg: averages.get(category) ?? 0 }))
    .sort((a, b) => b.total - a.total)

  const max = Math.max(1, ...rows.map((r) => Math.max(r.total, r.avg)))

  if (rows.every((r) => r.total === 0 && r.avg === 0)) {
    return <p className="finance__empty">No categorized spending yet.</p>
  }

  return (
    <div className="finance__cats">
      {rows.map((r) => (
        <div className="finance__cat" key={r.category}>
          <div className="finance__catTop">
            <span className="finance__catName">
              {CATEGORY_LABELS[r.category]}
              {r.category === 'subscriptions' && <span className="finance__catTag">subs</span>}
            </span>
            <span className="finance__catNum">{money(r.total)}</span>
          </div>
          <div className="finance__catBar">
            <div className="finance__catFill" style={{ width: `${(r.total / max) * 100}%` }} />
            <div className="finance__catAvg" style={{ left: `${(r.avg / max) * 100}%` }} title={`3-mo avg ${money(r.avg)}`} />
          </div>
          <span className="finance__catAvgLabel">3-mo avg {money(r.avg)}</span>
        </div>
      ))}
    </div>
  )
}
