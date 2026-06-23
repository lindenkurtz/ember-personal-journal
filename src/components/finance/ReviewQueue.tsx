import type { FinanceTransaction } from '../../../shared/finance/types'
import { money } from '../../lib/finance/format'

interface Props {
  items: FinanceTransaction[]
  onApprove: (id: string) => void
  onEdit: (txn: FinanceTransaction) => void
}

/** Flagged transactions (Venmo / peer transfers) awaiting a decision. */
export default function ReviewQueue({ items, onApprove, onEdit }: Props) {
  if (!items.length) return null
  return (
    <section className="dash__card">
      <div className="dash__cardHeader">
        <h2>Review queue</h2>
        <span className="muted">{items.length} pending</span>
      </div>
      <div className="finance__queue">
        {items.map((t) => (
          <div className="finance__queueRow" key={t.id}>
            <div className="finance__queueInfo">
              <span className="finance__queueName">{t.merchant_name ?? t.name ?? 'Unknown'}</span>
              <span className="finance__queueMeta">{t.date} · {money(t.amount, { cents: true, signed: true })}</span>
            </div>
            <div className="finance__queueActions">
              <button className="finance__ghostBtn" onClick={() => onEdit(t)}>Edit</button>
              <button className="finance__btn finance__btn--sm" onClick={() => onApprove(t.id)}>Approve</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
