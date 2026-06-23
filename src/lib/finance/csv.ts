/*
 * Apple Card CSV import — the primary path for Apple Card transactions, since
 * Goldman Sachs is unreliable-to-impossible through Plaid. Parses the native
 * "Apple Card Transactions" export and writes rows under a synthetic, net-worth-
 * excluded account. Re-importing the same file is a no-op (deterministic ids).
 */
import type { Category, FinanceAccount, FinanceTransaction } from '../../../shared/finance/types'
import { ensureLocalAccount } from './accounts'
import { insertTransactions } from './transactions'

export const APPLE_CARD_ACCOUNT_ID = 'csv-apple-card'

const APPLE_CARD_ACCOUNT: FinanceAccount = {
  account_id: APPLE_CARD_ACCOUNT_ID,
  item_id: null,
  name: 'Apple Card',
  official_name: 'Apple Card (CSV import)',
  institution_name: 'Apple Card',
  type: 'credit',
  subtype: 'credit card',
  mask: null,
  is_asset: false,
  include_in_net_worth: false, // a participant on mom's account — balance is misleading
  source: 'csv',
  last_synced_at: null
}

// Apple Card's own category column → our schema. Apple's set is small and stable.
const APPLE_CATEGORY_MAP: Record<string, Category> = {
  grocery: 'groceries',
  restaurants: 'dining',
  dining: 'dining',
  food: 'dining',
  shopping: 'shopping',
  entertainment: 'shopping',
  transportation: 'transportation',
  automotive: 'transportation',
  travel: 'transportation',
  health: 'health',
  personal: 'health',
  home: 'housing',
  'business services': 'school_work',
  education: 'school_work',
  other: 'shopping'
}

interface ParsedRow {
  date: string
  description: string
  merchant: string
  category: string
  type: string
  amount: number
}

// Minimal CSV line splitter that respects double-quoted fields.
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ } else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

// FNV-1a → hex. Stable across imports so duplicate rows collide on the same id.
function hashId(parts: string[]): string {
  let h = 0x811c9dc5
  const s = parts.join('|')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return 'csv-' + (h >>> 0).toString(16)
}

function toIsoDate(raw: string): string | null {
  // Apple exports MM/DD/YYYY.
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
  const [, mm, dd, yyyy] = m
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

export function parseAppleCardCsv(text: string): FinanceTransaction[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase())
  const idx = (name: string) => header.findIndex((h) => h.includes(name))
  const iDate = idx('transaction date') >= 0 ? idx('transaction date') : idx('date')
  const iDesc = idx('description')
  const iMerch = idx('merchant')
  const iCat = idx('category')
  const iType = idx('type')
  const iAmt = idx('amount')

  const rows: FinanceTransaction[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i])
    const date = toIsoDate(cols[iDate] ?? '')
    if (!date) continue
    const parsed: ParsedRow = {
      date,
      description: cols[iDesc] ?? '',
      merchant: iMerch >= 0 ? cols[iMerch] ?? '' : '',
      category: iCat >= 0 ? cols[iCat] ?? '' : '',
      type: iType >= 0 ? (cols[iType] ?? '').toLowerCase() : '',
      amount: parseFloat((cols[iAmt] ?? '0').replace(/[$,]/g, '')) || 0
    }
    const isPayment = parsed.type.includes('payment')
    // Apple gives purchases as positive; we store outflows negative.
    const amount = -parsed.amount
    const category: Category = isPayment
      ? 'transfer'
      : APPLE_CATEGORY_MAP[parsed.category.toLowerCase()] ?? 'shopping'
    rows.push({
      id: hashId([parsed.date, String(parsed.amount), parsed.description, parsed.merchant]),
      account_id: APPLE_CARD_ACCOUNT_ID,
      date: parsed.date,
      amount,
      merchant_name: parsed.merchant || null,
      name: parsed.description || parsed.merchant || null,
      plaid_category: parsed.category || null,
      category,
      notes: isPayment ? 'Card Payment' : null,
      is_transfer: isPayment,
      is_split: false,
      split_amount: null,
      flagged_for_review: false,
      reviewed: true,
      source: 'csv',
      pending: false
    })
  }
  return rows
}

export async function importAppleCardCsv(file: File): Promise<{ parsed: number; inserted: number }> {
  const text = await file.text()
  const rows = parseAppleCardCsv(text)
  if (!rows.length) return { parsed: 0, inserted: 0 }
  await ensureLocalAccount(APPLE_CARD_ACCOUNT)
  const inserted = await insertTransactions(rows)
  return { parsed: rows.length, inserted }
}
