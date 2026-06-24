import { useEffect, useMemo, useState } from 'react'
import type { FinanceTransaction } from '../../../shared/finance/types'
import { getAllTransactions } from '../../lib/finance/transactions'
import { monthKey, prettyMonth } from '../../lib/date'
import TransactionList from './TransactionList'

interface Props {
  onEdit: (txn: FinanceTransaction) => void
  onClose: () => void
}

/** All-time transactions, fetched on open and grouped by month. */
export default function AllTransactions({ onEdit, onClose }: Props) {
  const [items, setItems] = useState<FinanceTransaction[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getAllTransactions()
      .then((rows) => { if (!cancelled) setItems(rows) })
      .catch((e) => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [])

  const byMonth = useMemo(() => {
    const map = new Map<string, FinanceTransaction[]>()
    for (const t of items ?? []) {
      const k = monthKey(t.date)
      const arr = map.get(k) ?? []
      arr.push(t)
      map.set(k, arr)
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [items])

  return (
    <div className="finance__overlay" onClick={onClose}>
      <div className="finance__editor finance__editor--wide finance__editor--tall" onClick={(e) => e.stopPropagation()}>
        <div className="finance__editorHead">
          <div>
            <div className="finance__editorName">All transactions</div>
            <div className="finance__editorMeta">{items ? `${items.length} total` : 'Loading…'}</div>
          </div>
          <button className="finance__iconBtn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {error ? (
          <p className="finance__empty">Couldn’t load transactions: {error}</p>
        ) : !items ? (
          <p className="finance__empty">Loading…</p>
        ) : items.length === 0 ? (
          <p className="finance__empty">No transactions yet.</p>
        ) : (
          <div className="finance__allList">
            {byMonth.map(([m, rows]) => (
              <div key={m} className="finance__allMonth">
                <div className="finance__allMonthHead">{prettyMonth(m)}</div>
                <TransactionList items={rows} onEdit={onEdit} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
