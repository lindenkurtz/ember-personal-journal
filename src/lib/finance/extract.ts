/*
 * Screenshot → transactions. The primary path for Apple Card / Apple Cash,
 * which Plaid can't reach and (as a Family participant) the user can't CSV-export.
 * Sends screenshots to Claude (via the existing /api/claude vision proxy), which
 * returns structured rows tagged with our category schema. Rows come back as
 * *candidates* for the user to review and confirm before insert.
 */
import type { Category, FinanceAccount, FinanceTransaction } from '../../../shared/finance/types'
import { CATEGORIES, CATEGORY_LABELS } from '../../../shared/finance/categories'
import { callClaude } from '../claude'
import { todayKey } from '../date'
import { contentHash } from './hash'

async function fileToImage(file: File): Promise<{ media_type: string; data: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return { media_type: file.type || 'image/png', data: btoa(binary) }
}

interface RawRow {
  date?: string
  merchant?: string
  amount?: number
  category?: string
}

function systemPrompt(): string {
  const labels = CATEGORIES.map((c) => `${c} (${CATEGORY_LABELS[c]})`).join(', ')
  return [
    'You extract financial transactions from one or more screenshots of a bank or credit-card transaction list.',
    'Respond with ONLY a JSON array — no markdown fences, no prose.',
    'Each element: {"date":"YYYY-MM-DD","merchant":string,"amount":number,"category":CATEGORY}.',
    'amount is NEGATIVE for money spent or sent out, POSITIVE for money received.',
    'Use the date shown on each transaction; if the year is missing, infer the most recent year on or before today.',
    `CATEGORY must be exactly one of: ${labels}.`,
    'A payment to a credit card or a move between the owner’s own accounts is "transfer".',
    'Money to or from a specific person (Venmo, sending Apple Cash to someone) is "peer_payment".',
    'Skip pending/authorization-only rows that show no amount.'
  ].join(' ')
}

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
}

function toIso(raw: string | undefined): string | null {
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return null
  const [, mm, dd, yy] = m
  const year = yy.length === 2 ? `20${yy}` : yy
  return `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

/** Parse Claude's JSON into candidate rows for the given account. Not inserted yet. */
export async function extractTransactions(files: File[], account: FinanceAccount): Promise<FinanceTransaction[]> {
  const images = await Promise.all(files.map(fileToImage))
  const text = await callClaude({
    system: systemPrompt(),
    prompt: `Account: ${account.name}. Today is ${todayKey()}. Extract every transaction visible in the image(s).`,
    images,
    max_tokens: 1500
  })

  let raw: RawRow[]
  try {
    const parsed = JSON.parse(stripFences(text))
    raw = Array.isArray(parsed) ? parsed : []
  } catch {
    throw new Error('Could not read the screenshot — try a clearer/cropped image.')
  }

  const byId = new Map<string, FinanceTransaction>()
  for (const r of raw) {
    const date = toIso(r.date)
    const amount = typeof r.amount === 'number' ? r.amount : parseFloat(String(r.amount ?? ''))
    if (!date || Number.isNaN(amount)) continue
    const category: Category = CATEGORIES.includes(r.category as Category) ? (r.category as Category) : 'shopping'
    const merchant = (r.merchant ?? '').trim() || null
    const id = 'shot-' + contentHash([date, amount, merchant ?? '', account.account_id])
    byId.set(id, {
      id,
      account_id: account.account_id,
      date,
      amount,
      merchant_name: merchant,
      name: merchant,
      plaid_category: null,
      category,
      notes: null,
      is_transfer: category === 'transfer',
      is_split: false,
      split_amount: null,
      savings_bucket: null,
      flagged_for_review: category === 'peer_payment',
      reviewed: false,
      source: 'manual',
      pending: false
    })
  }
  return [...byId.values()].sort((a, b) => (a.date < b.date ? 1 : -1))
}
