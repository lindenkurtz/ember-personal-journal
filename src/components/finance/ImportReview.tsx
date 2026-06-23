import { useState } from 'react'
import type { Category, FinanceTransaction } from '../../../shared/finance/types'
import { CATEGORIES, CATEGORY_LABELS } from '../../../shared/finance/categories'
import { money } from '../../lib/finance/format'

interface Props {
  candidates: FinanceTransaction[]
  onConfirm: (rows: FinanceTransaction[]) => Promise<void>
  onClose: () => void
}

/** Review parsed screenshot rows before they're inserted. Edit category, drop bad rows. */
export default function ImportReview({ candidates, onConfirm, onClose }: Props) {
  const [rows, setRows] = useState(candidates)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  function setCategory(id: string, category: Category) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, category, is_transfer: category === 'transfer' } : r)))
  }

  function toggle(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const included = rows.filter((r) => !excluded.has(r.id))

  async function confirm() {
    setSaving(true)
    try {
      // The user has seen these, so mark reviewed and clear the auto-flag.
      await onConfirm(included.map((r) => ({ ...r, reviewed: true, flagged_for_review: false })))
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="finance__overlay" onClick={onClose}>
      <div className="finance__editor finance__editor--wide" onClick={(e) => e.stopPropagation()}>
        <div className="finance__editorHead">
          <div>
            <div className="finance__editorName">Review {included.length} transaction{included.length === 1 ? '' : 's'}</div>
            <div className="finance__editorMeta">Fix categories, untick anything wrong, then add.</div>
          </div>
          <button className="finance__iconBtn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {rows.length === 0 ? (
          <p className="finance__empty">Nothing was read from the image.</p>
        ) : (
          <div className="finance__importList">
            {rows.map((r) => (
              <div className={'finance__importRow' + (excluded.has(r.id) ? ' is-excluded' : '')} key={r.id}>
                <input type="checkbox" checked={!excluded.has(r.id)} onChange={() => toggle(r.id)} />
                <div className="finance__importInfo">
                  <span className="finance__importName">{r.merchant_name ?? 'Unknown'}</span>
                  <span className="finance__importMeta">{r.date} · {money(r.amount, { cents: true, signed: true })}</span>
                </div>
                <select
                  value={r.category}
                  onChange={(e) => setCategory(r.id, e.target.value as Category)}
                  disabled={excluded.has(r.id)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}

        <div className="finance__editorActions">
          <button className="finance__ghostBtn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="finance__btn" onClick={confirm} disabled={saving || included.length === 0}>
            {saving ? 'Adding…' : `Add ${included.length}`}
          </button>
        </div>
      </div>
    </div>
  )
}
