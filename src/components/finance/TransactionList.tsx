import type { FinanceTransaction } from '../../../shared/finance/types'
import { CATEGORY_LABELS } from '../../../shared/finance/categories'
import { money } from '../../lib/finance/format'

interface Props {
  items: FinanceTransaction[]
  onEdit: (txn: FinanceTransaction) => void
}

export default function TransactionList({ items, onEdit }: Props) {
  if (!items.length) {
    return <p className="finance__empty">No transactions this month.</p>
  }
  return (
    <div className="finance__txns">
      {items.map((t) => (
        <button className="finance__txn" key={t.id} onClick={() => onEdit(t)}>
          <div className="finance__txnLeft">
            <span className="finance__txnName">{t.merchant_name ?? t.name ?? 'Unknown'}</span>
            <span className="finance__txnMeta">
              {t.date} · {CATEGORY_LABELS[t.category]}
              {t.is_transfer && ' · transfer'}
              {t.pending && ' · pending'}
            </span>
          </div>
          <span className={'finance__txnAmt' + (t.amount < 0 ? ' is-neg' : ' is-pos')}>
            {money(t.amount, { cents: true, signed: true })}
          </span>
        </button>
      ))}
    </div>
  )
}
