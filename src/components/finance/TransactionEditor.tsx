import { useState } from 'react'
import type { Category, FinanceTransaction, SavingsBucket } from '../../../shared/finance/types'
import { CATEGORIES, CATEGORY_LABELS } from '../../../shared/finance/categories'
import type { TransactionPatch } from '../../lib/finance/transactions'
import type { NewRule } from '../../lib/finance/rules'
import { money } from '../../lib/finance/format'

const SAVINGS_LABELS: Record<SavingsBucket, string> = {
  short_term: 'Short-term (Emergency)',
  long_term: 'Long-term (Investments)',
  retirement: 'Retirement (Roth IRA)'
}

interface Props {
  txn: FinanceTransaction
  accountName?: string | null
  onSave: (patch: TransactionPatch) => Promise<void>
  onClose: () => void
  onDelete?: (id: string) => Promise<void>
  onCreateRule?: (rule: NewRule) => Promise<void>
}

/** Full per-transaction editor — every field the user can override. */
export default function TransactionEditor({ txn, accountName, onSave, onClose, onDelete, onCreateRule }: Props) {
  const [category, setCategory] = useState<Category>(txn.category)
  const [notes, setNotes] = useState(txn.notes ?? '')
  const [isTransfer, setIsTransfer] = useState(txn.is_transfer)
  const [savingsBucket, setSavingsBucket] = useState<SavingsBucket | ''>(txn.savings_bucket ?? '')
  const [makeRule, setMakeRule] = useState(false)
  const [saving, setSaving] = useState(false)

  const matchText = txn.merchant_name ?? txn.name ?? ''
  const canRule = !!matchText && !!onCreateRule

  function markCreditCardPayment() {
    setCategory('transfer')
    setIsTransfer(true)
    setSavingsBucket('')
    if (!notes.trim()) setNotes('Credit Card Payment')
  }

  async function save() {
    setSaving(true)
    try {
      const trimmedNotes = notes.trim() || null
      if (makeRule && canRule && onCreateRule) {
        await onCreateRule({
          match_text: matchText,
          category,
          note: trimmedNotes,
          savings_bucket: savingsBucket || null
        })
      }
      await onSave({
        id: txn.id,
        category,
        notes: trimmedNotes,
        is_transfer: isTransfer,
        savings_bucket: savingsBucket || null,
        // Editing a transaction marks it reviewed: it leaves the review queue
        // and is preserved verbatim across future syncs.
        reviewed: true,
        flagged_for_review: false
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
            <div className="finance__editorMeta">
              {txn.date} · {money(txn.amount, { cents: true, signed: true })}
              {accountName ? ` · ${accountName}` : ''}
            </div>
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

        <button className="finance__ghostBtn finance__ghostBtn--sm" onClick={markCreditCardPayment}>
          Mark as credit-card payment
        </button>

        <label className="finance__field">
          <span>Notes</span>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
        </label>

        <label className="finance__check">
          <input type="checkbox" checked={isTransfer} onChange={(e) => setIsTransfer(e.target.checked)} />
          <span>Internal transfer (exclude from spending)</span>
        </label>

        <label className="finance__field">
          <span>Savings contribution</span>
          <select value={savingsBucket} onChange={(e) => setSavingsBucket(e.target.value as SavingsBucket | '')}>
            <option value="">Not savings</option>
            {(Object.keys(SAVINGS_LABELS) as SavingsBucket[]).map((b) => (
              <option key={b} value={b}>{SAVINGS_LABELS[b]}</option>
            ))}
          </select>
        </label>

        {canRule && (
          <label className="finance__check">
            <input type="checkbox" checked={makeRule} onChange={(e) => setMakeRule(e.target.checked)} />
            <span>Always classify “{matchText}” as {CATEGORY_LABELS[category]} from now on</span>
          </label>
        )}

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
