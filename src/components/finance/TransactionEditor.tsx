import { useState } from 'react'
import type { Category, FinanceTransaction, SavingsBucket } from '../../../shared/finance/types'
import { CATEGORIES, CATEGORY_LABELS } from '../../../shared/finance/categories'
import type { TransactionPatch } from '../../lib/finance/transactions'
import { money } from '../../lib/finance/format'

const SAVINGS_LABELS: Record<SavingsBucket, string> = {
  short_term: 'Short-term (Emergency)',
  long_term: 'Long-term (Investments)',
  retirement: 'Retirement (Roth IRA)'
}

interface Props {
  txn: FinanceTransaction
  onSave: (patch: TransactionPatch) => Promise<void>
  onClose: () => void
  onDelete?: (id: string) => Promise<void>
}

/** Full per-transaction editor — every field the user can override. */
export default function TransactionEditor({ txn, onSave, onClose, onDelete }: Props) {
  const [category, setCategory] = useState<Category>(txn.category)
  const [notes, setNotes] = useState(txn.notes ?? '')
  const [isTransfer, setIsTransfer] = useState(txn.is_transfer)
  const [isSplit, setIsSplit] = useState(txn.is_split)
  const [splitAmount, setSplitAmount] = useState(txn.split_amount?.toString() ?? '')
  const [savingsBucket, setSavingsBucket] = useState<SavingsBucket | ''>(txn.savings_bucket ?? '')
  const [reviewed, setReviewed] = useState(txn.reviewed)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await onSave({
        id: txn.id,
        category,
        notes: notes.trim() || null,
        is_transfer: isTransfer,
        is_split: isSplit,
        split_amount: isSplit && splitAmount ? parseFloat(splitAmount) : null,
        savings_bucket: savingsBucket || null,
        reviewed,
        flagged_for_review: txn.flagged_for_review && !reviewed
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="finance__overlay" onClick={onClose}>
      <div className="finance__editor" onClick={(e) => e.stopPropagation()}>
        <div className="finance__editorHead">
          <div>
            <div className="finance__editorName">{txn.merchant_name ?? txn.name ?? 'Transaction'}</div>
            <div className="finance__editorMeta">{txn.date} · {money(txn.amount, { cents: true, signed: true })}</div>
          </div>
          <button className="finance__iconBtn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <label className="finance__field">
          <span>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </label>

        <label className="finance__field">
          <span>Notes</span>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
        </label>

        <label className="finance__check">
          <input type="checkbox" checked={isTransfer} onChange={(e) => setIsTransfer(e.target.checked)} />
          <span>Internal transfer (exclude from spending)</span>
        </label>

        <label className="finance__check">
          <input type="checkbox" checked={isSplit} onChange={(e) => setIsSplit(e.target.checked)} />
          <span>Split — I only owe part of this</span>
        </label>
        {isSplit && (
          <label className="finance__field">
            <span>My actual amount</span>
            <input type="number" inputMode="decimal" value={splitAmount} onChange={(e) => setSplitAmount(e.target.value)} placeholder="0.00" />
          </label>
        )}

        <label className="finance__field">
          <span>Savings contribution</span>
          <select value={savingsBucket} onChange={(e) => setSavingsBucket(e.target.value as SavingsBucket | '')}>
            <option value="">Not savings</option>
            {(Object.keys(SAVINGS_LABELS) as SavingsBucket[]).map((b) => (
              <option key={b} value={b}>{SAVINGS_LABELS[b]}</option>
            ))}
          </select>
        </label>

        <label className="finance__check">
          <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
          <span>Reviewed</span>
        </label>

        <div className="finance__editorActions">
          {onDelete && (
            <button className="finance__ghostBtn finance__ghostBtn--danger" onClick={() => onDelete(txn.id)} disabled={saving}>
              Delete
            </button>
          )}
          <button className="finance__btn" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
