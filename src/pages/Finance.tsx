import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Category, FinanceAccount, FinanceBalance, FinanceSettings, LoanBalance, NetWorthSnapshot, FinanceTransaction } from '../../shared/finance/types'
import { getAccounts, updateAccount } from '../lib/finance/accounts'
import { getLatestBalances, getNetWorthSnapshots } from '../lib/finance/balances'
import { getFinanceSettings, updateFinanceSettings } from '../lib/finance/settings'
import { getLatestLoan, setManualLoan } from '../lib/finance/loans'
import { getTransactionsRange, getReviewQueue, updateTransaction, deleteTransaction, TransactionPatch } from '../lib/finance/transactions'
import { runPlaidSync } from '../lib/finance/plaid'
import { importAppleCardCsv } from '../lib/finance/csv'
import { cashFlow, categoryBreakdown, savingsRates, subscriptionsTotal } from '../lib/finance/analytics'
import { monthKey, monthRange, prevMonthKey, prettyMonth } from '../lib/date'
import { money } from '../lib/finance/format'
import PlaidLinkButton from '../components/finance/PlaidLinkButton'
import NetWorthChart from '../components/finance/NetWorthChart'
import CashFlowChart from '../components/finance/CashFlowChart'
import CategoryBreakdown from '../components/finance/CategoryBreakdown'
import MonthlySummary from '../components/finance/MonthlySummary'
import ReviewQueue from '../components/finance/ReviewQueue'
import TransactionList from '../components/finance/TransactionList'
import TransactionEditor from '../components/finance/TransactionEditor'
import './Finance.css'

export default function Finance() {
  const [accounts, setAccounts] = useState<FinanceAccount[]>([])
  const [balances, setBalances] = useState<Map<string, FinanceBalance>>(new Map())
  const [snapshots, setSnapshots] = useState<NetWorthSnapshot[]>([])
  const [settings, setSettings] = useState<FinanceSettings | null>(null)
  const [loan, setLoan] = useState<LoanBalance | null>(null)
  const [txns, setTxns] = useState<FinanceTransaction[]>([]) // last ~4 months
  const [review, setReview] = useState<FinanceTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [editing, setEditing] = useState<FinanceTransaction | null>(null)
  const csvInput = useRef<HTMLInputElement>(null)

  const month = monthKey()
  const startMonth = prevMonthKey(prevMonthKey(prevMonthKey(month)))

  async function load() {
    const range = monthRange(startMonth)
    const end = monthRange(month).end
    const [acc, bal, snaps, set, ln, tx, rev] = await Promise.all([
      getAccounts(),
      getLatestBalances(),
      getNetWorthSnapshots(),
      getFinanceSettings(),
      getLatestLoan(),
      getTransactionsRange(range.start, end),
      getReviewQueue()
    ])
    setAccounts(acc)
    setBalances(bal)
    setSnapshots(snaps)
    setSettings(set)
    setLoan(ln)
    setTxns(tx)
    setReview(rev)
  }

  useEffect(() => {
    let cancelled = false
    load()
      .catch((e) => console.error('[finance]', e))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const txnsByMonth = useMemo(() => {
    const map = new Map<string, FinanceTransaction[]>()
    for (const t of txns) {
      const k = monthKey(t.date)
      const arr = map.get(k) ?? []
      arr.push(t)
      map.set(k, arr)
    }
    return map
  }, [txns])

  const monthTxns = txnsByMonth.get(month) ?? []
  const priorTxns = txnsByMonth.get(prevMonthKey(month)) ?? []

  const flow = cashFlow(monthTxns)
  const priorFlow = cashFlow(priorTxns)
  const breakdown = categoryBreakdown(monthTxns)
  const subs = subscriptionsTotal(monthTxns)
  const savings = savingsRates(monthTxns, accounts, flow.income)

  // 3-month rolling average per category over the three months before this one.
  const averages = useMemo(() => {
    const months = [prevMonthKey(month), prevMonthKey(prevMonthKey(month)), prevMonthKey(prevMonthKey(prevMonthKey(month)))]
    const sums = new Map<Category, number>()
    for (const m of months) {
      for (const slice of categoryBreakdown(txnsByMonth.get(m) ?? [])) {
        sums.set(slice.category, (sums.get(slice.category) ?? 0) + slice.total)
      }
    }
    const avg = new Map<Category, number>()
    for (const [c, total] of sums) avg.set(c, total / 3)
    return avg
  }, [txnsByMonth, month])

  const latestSnapshot = snapshots.length ? snapshots[snapshots.length - 1] : null

  async function handleSync() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const s = await runPlaidSync()
      setSyncMsg(`Synced ${s.accounts} accounts · +${s.added} new${s.errors.length ? ` · ${s.errors.length} errors` : ''}`)
      await load()
    } catch (e) {
      setSyncMsg(`Sync failed: ${e}`)
    } finally {
      setSyncing(false)
    }
  }

  async function handleCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const r = await importAppleCardCsv(file)
      setSyncMsg(`Apple Card: imported ${r.inserted} of ${r.parsed} rows`)
      await load()
    } catch (err) {
      setSyncMsg(`CSV import failed: ${err}`)
    } finally {
      if (csvInput.current) csvInput.current.value = ''
    }
  }

  async function handleSave(patch: TransactionPatch) {
    await updateTransaction(patch)
    await load()
  }

  async function handleApprove(id: string) {
    await updateTransaction({ id, reviewed: true, flagged_for_review: false })
    await load()
  }

  async function handleDelete(id: string) {
    await deleteTransaction(id)
    setEditing(null)
    await load()
  }

  async function toggleInclude(a: FinanceAccount) {
    setAccounts((prev) => prev.map((x) => x.account_id === a.account_id ? { ...x, include_in_net_worth: !x.include_in_net_worth } : x))
    await updateAccount({ account_id: a.account_id, include_in_net_worth: !a.include_in_net_worth })
    await load()
  }

  async function handleManualLoan() {
    const raw = window.prompt('Servicer loan balance ($):', loan ? String(loan.balance) : '')
    if (raw == null) return
    const v = parseFloat(raw.replace(/[$,]/g, ''))
    if (Number.isNaN(v)) return
    await setManualLoan(v)
    await load()
  }

  async function handlePayee(value: string) {
    const next = await updateFinanceSettings({ cc_payment_payee: value.trim() || null })
    setSettings(next)
  }

  return (
    <main className="finance">
      <header className="finance__header">
        <div>
          <p className="finance__eyebrow">Finance</p>
          <h1 className="finance__title">{latestSnapshot ? money(latestSnapshot.net_worth) : '—'}</h1>
          <p className="finance__subtitle">
            net worth
            {latestSnapshot && <> · {money(latestSnapshot.assets_total)} assets − {money(latestSnapshot.liabilities_total)} debt</>}
          </p>
        </div>
        <Link to="/" className="finance__back">← Home</Link>
      </header>

      <section className="finance__bar">
        <button className="finance__btn" onClick={handleSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        <PlaidLinkButton onLinked={load} />
        <button className="finance__ghostBtn" onClick={() => csvInput.current?.click()}>Import Apple Card CSV</button>
        <input ref={csvInput} type="file" accept=".csv" hidden onChange={handleCsv} />
        {settings?.last_full_sync_date && <span className="finance__synced">last sync {settings.last_full_sync_date}</span>}
      </section>
      {syncMsg && <p className="finance__syncMsg">{syncMsg}</p>}

      {loading ? (
        <p className="finance__empty" style={{ textAlign: 'center', padding: '40px 0' }}>Loading…</p>
      ) : accounts.length === 0 && txns.length === 0 ? (
        <section className="dash__card">
          <p className="finance__empty">No accounts yet. Connect a bank with Plaid, or import an Apple Card CSV to get started.</p>
        </section>
      ) : (
        <>
          <MonthlySummary
            monthLabel={prettyMonth(month)}
            flow={flow}
            prior={priorFlow}
            savings={savings}
            subsTotal={subs}
            pendingReview={review.length}
          />

          <ReviewQueue items={review} onApprove={handleApprove} onEdit={setEditing} />

          <section className="dash__card">
            <div className="dash__cardHeader"><h2>Net worth</h2><span className="muted">all-time</span></div>
            <NetWorthChart snapshots={snapshots} />
          </section>

          <section className="dash__card">
            <div className="dash__cardHeader"><h2>Cash flow</h2><span className="muted">{prettyMonth(month)} · transfers excluded</span></div>
            <CashFlowChart flow={flow} />
          </section>

          <section className="dash__card">
            <div className="dash__cardHeader"><h2>Categories</h2><span className="muted">this month vs 3-mo avg</span></div>
            <CategoryBreakdown current={breakdown} averages={averages} />
          </section>

          <section className="dash__card">
            <div className="dash__cardHeader"><h2>Accounts</h2><span className="muted">tap to toggle net worth</span></div>
            <div className="finance__accts">
              {accounts.map((a) => {
                const bal = balances.get(a.account_id)
                return (
                  <button key={a.account_id} className="finance__acct" onClick={() => toggleInclude(a)}>
                    <div className="finance__acctLeft">
                      <span className="finance__acctName">{a.name}{a.mask ? ` ··${a.mask}` : ''}</span>
                      <span className="finance__acctInst">{a.institution_name ?? a.source}{a.include_in_net_worth ? '' : ' · excluded'}</span>
                    </div>
                    <span className="finance__acctBal">{bal ? money(bal.balance) : '—'}</span>
                  </button>
                )
              })}
            </div>
            <div className="finance__loan">
              <span>Servicer loan: <strong>{loan ? money(loan.balance) : 'not set'}</strong>{loan ? ` (${loan.source})` : ''}</span>
              <button className="finance__ghostBtn finance__ghostBtn--sm" onClick={handleManualLoan}>Set manually</button>
            </div>
          </section>

          <section className="dash__card">
            <div className="dash__cardHeader"><h2>Transactions</h2><span className="muted">{prettyMonth(month)}</span></div>
            <TransactionList items={monthTxns} onEdit={setEditing} />
          </section>

          <section className="dash__card">
            <div className="dash__cardHeader"><h2>Rules</h2></div>
            <label className="finance__field">
              <span>Credit-card-payment payee (Apple Cash → mom)</span>
              <input
                type="text"
                defaultValue={settings?.cc_payment_payee ?? ''}
                placeholder="e.g. mom's Venmo/name"
                onBlur={(e) => handlePayee(e.target.value)}
              />
            </label>
            <p className="finance__hint">Transactions to this payee are auto-tagged as Credit Card Payment (transfer) on the next sync.</p>
          </section>
        </>
      )}

      {editing && (
        <TransactionEditor
          txn={editing}
          onSave={handleSave}
          onClose={() => setEditing(null)}
          onDelete={handleDelete}
        />
      )}
    </main>
  )
}
