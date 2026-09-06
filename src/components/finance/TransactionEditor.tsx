import { useState } from 'react'
import type { Category, FinanceTransaction, SavingsBucket } from '../../../shared/finance/types'
import { CATEGORIES, CATEGORY_LABELS } from '../../../shared/finance/categories'
import { brokerageDestToken } from '../../../shared/finance/classify'
import type { TransactionPatch } from '../../lib/finance/transactions'
import type { NewRule } from '../../lib/finance/rules'
import { money } from '../../lib/finance/format'

const SAVINGS_LABELS: Record<SavingsBucket, string> = {
  short_term: 'Short-term (Emergency)',
  long_term: 'Long-term (Investments)',
  retirement: 'Retirement'
}

interface Props {
  txn: FinanceTransaction
  accountName?: string | null
  onSave: (patch: TransactionPatch) => Promise<void>
  onClose: () => void
  onDelete?: (id: string) => Promise<void>
  onCreateRule?: (rule: NewRule) => Promise<void>
  /** From finance_settings.brokerage_match; empty disables destination auto-learn. */
  brokerageMatch?: string[]
}

/** Full per-transaction editor — every field the user can override. */
export default function TransactionEditor({ txn, accountName, onSave, onClose, onDelete, onCreateRule, brokerageMatch = [] }: Props) {
  const [category, setCategory] = useState<Category>(txn.category)
  const [notes, setNotes] = useState(txn.notes ?? '')
  const [isTransfer, setIsTransfer] = useState(txn.is_transfer)
  const [savingsBucket, setSavingsBucket] = useState<SavingsBucket | ''>(txn.savings_bucket ?? '')
  const [incomeSource, setIncomeSource] = useState(txn.income_source ?? '')
  const [makeRule, setMakeRule] = useState(false)
  const [ruleMatch, setRuleMatch] = useState(txn.merchant_name ?? txn.name ?? '')
  const [saving, setSaving] = useState(false)

  const canRule = !!onCreateRule

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
      // The income label only applies to income rows; clear it otherwise so a
      // recategorized transaction never carries a stale source.
      const source = category === 'income' ? incomeSource.trim() || null : null
      const bucket = savingsBucket || null
      if (makeRule && onCreateRule && ruleMatch.trim()) {
        await onCreateRule({
          match_text: ruleMatch,
          category,
          note: trimmedNotes,
          savings_bucket: bucket,
          income_source: source
        })
      }
      // Auto-learn the savings destination from the masked clearing-account
      // number so future transfers to the same bucket classify without review.
      const token = bucket && category === 'transfer' ? brokerageDestToken(txn.name, txn.merchant_name, brokerageMatch) : null
      if (token && onCreateRule && !(makeRule && ruleMatch.trim().toLowerCase() === token)) {
        await onCreateRule({ match_text: token, category: 'transfer', note: null, savings_bucket: bucket, income_source: null })
      }
      await onSave({
        id: txn.id,
        category,
        notes: trimmedNotes,
        is_transfer: isTransfer,
        savings_bucket: savingsBucket || null,
        income_source: source,
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

        {category === 'income' && (
          <label className="finance__field">
            <span>Income source</span>
            <input
              type="text"
              value={incomeSource}
              onChange={(e) => setIncomeSource(e.target.value)}
              placeholder="e.g. AcmeCorp · blank = Misc"
            />
          </label>
        )}

        {canRule && (
          <>
            <label className="finance__check">
              <input type="checkbox" checked={makeRule} onChange={(e) => setMakeRule(e.target.checked)} />
              <span>
                Always classify matching transactions as {CATEGORY_LABELS[category]}
                {savingsBucket ? ` · ${SAVINGS_LABELS[savingsBucket]}` : ''}
                {category === 'income' && incomeSource.trim() ? ` · ${incomeSource.trim()}` : ''} from now on
              </span>
            </label>
            {makeRule && (
              <label className="finance__field">
                <span>Match when the description contains</span>
                <input
                  type="text"
                  value={ruleMatch}
                  onChange={(e) => setRuleMatch(e.target.value)}
                  placeholder="e.g. XXXXXX1234"
                />
              </label>
            )}
          </>
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
