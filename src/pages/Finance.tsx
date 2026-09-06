import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Category, FinanceAccount, FinanceBalance, FinanceRule, FinanceSettings, LoanBalance, NetWorthSnapshot, FinanceTransaction } from '../../shared/finance/types'
import { getAccounts, updateAccount } from '../lib/finance/accounts'
import { getLatestBalances, getBalanceHistory, getNetWorthSnapshots } from '../lib/finance/balances'
import { getFinanceSettings } from '../lib/finance/settings'
import { getLatestLoan, setManualLoan } from '../lib/finance/loans'
import { getTransactionsRange, getReviewQueue, updateTransaction, deleteTransaction, insertTransactions, TransactionPatch } from '../lib/finance/transactions'
import { getRules, upsertRuleByMatch, deleteRule, NewRule } from '../lib/finance/rules'
import { runPlaidSync } from '../lib/finance/plaid'
import { extractTransactions } from '../lib/finance/extract'
import { LOCAL_ACCOUNTS, ensureLocal } from '../lib/finance/localAccounts'
import { cashFlow, categoryBreakdown, incomeBySource, savingsRates } from '../lib/finance/analytics'
import { CATEGORY_LABELS } from '../../shared/finance/categories'
import { parseBrokerageMatch } from '../../shared/finance/classify'
import { monthKey, monthRange, prevMonthKey, nextMonthKey, prettyMonth } from '../lib/date'
import { money } from '../lib/finance/format'
import PlaidLinkButton from '../components/finance/PlaidLinkButton'
import ImportReview from '../components/finance/ImportReview'
import NetWorthChart from '../components/finance/NetWorthChart'
import CashFlowChart from '../components/finance/CashFlowChart'
import CategoryBreakdown from '../components/finance/CategoryBreakdown'
import MonthlySummary from '../components/finance/MonthlySummary'
import ReviewQueue from '../components/finance/ReviewQueue'
import TransactionList from '../components/finance/TransactionList'
import TransactionEditor from '../components/finance/TransactionEditor'
import AllTransactions from '../components/finance/AllTransactions'
import './Finance.css'

export default function Finance() {
  const [accounts, setAccounts] = useState<FinanceAccount[]>([])
  const [balances, setBalances] = useState<Map<string, FinanceBalance>>(new Map())
  const [balanceHistory, setBalanceHistory] = useState<FinanceBalance[]>([])
  const [snapshots, setSnapshots] = useState<NetWorthSnapshot[]>([])
  const [settings, setSettings] = useState<FinanceSettings | null>(null)
  const [loan, setLoan] = useState<LoanBalance | null>(null)
  const [txns, setTxns] = useState<FinanceTransaction[]>([]) // last ~4 months
  const [review, setReview] = useState<FinanceTransaction[]>([])
  const [rules, setRules] = useState<FinanceRule[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [editing, setEditing] = useState<FinanceTransaction | null>(null)
  const [candidates, setCandidates] = useState<FinanceTransaction[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [shotAccount, setShotAccount] = useState(LOCAL_ACCOUNTS[0].account_id)
  const [importing, setImporting] = useState(false)
  const shotInput = useRef<HTMLInputElement>(null)

  const currentMonth = monthKey()
  const [month, setMonth] = useState(currentMonth)
  // Transactions are loaded for a 4-month window ending at the viewed month so
  // the "vs last month" delta and the 3-month category average have their inputs.
  const startMonth = prevMonthKey(prevMonthKey(prevMonthKey(month)))

  async function load() {
    const range = monthRange(startMonth)
    const end = monthRange(month).end
    const [acc, bal, hist, snaps, set, ln, tx, rev, rul] = await Promise.all([
      getAccounts(),
      getLatestBalances(),
      getBalanceHistory(),
      getNetWorthSnapshots(),
      getFinanceSettings(),
      getLatestLoan(),
      getTransactionsRange(range.start, end),
      getReviewQueue(),
      getRules()
    ])
    setAccounts(acc)
    setBalances(bal)
    setBalanceHistory(hist)
    setSnapshots(snaps)
    setSettings(set)
    setLoan(ln)
    setTxns(tx)
    setReview(rev)
    setRules(rul)
  }

  const accountName = (id: string | null): string | null => {
    if (!id) return null
    const a = accounts.find((x) => x.account_id === id) ?? LOCAL_ACCOUNTS.find((x) => x.account_id === id)
    return a ? a.name : null
  }

  useEffect(() => {
    let cancelled = false
    load()
      .catch((e) => console.error('[finance]', e))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-fetch only the transaction window when navigating to another month; the
  // account/snapshot data is month-independent so it isn't refetched here.
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    let cancelled = false
    const start = monthRange(prevMonthKey(prevMonthKey(prevMonthKey(month)))).start
    const end = monthRange(month).end
    getTransactionsRange(start, end)
      .then((tx) => { if (!cancelled) setTxns(tx) })
      .catch((e) => console.error('[finance]', e))
    return () => { cancelled = true }
  }, [month])

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
  const income = incomeBySource(monthTxns)
  const savings = savingsRates(monthTxns, flow.income)
  const subItems = monthTxns
    .filter((t) => t.category === 'subscriptions' && t.amount < 0)
    .map((t) => ({ name: t.merchant_name ?? t.name ?? 'Subscription', amount: t.amount }))

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

  async function handleScreenshot(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setImporting(true)
    setSyncMsg(null)
    try {
      const account = LOCAL_ACCOUNTS.find((a) => a.account_id === shotAccount)!
      const rows = await extractTransactions(files, account)
      if (!rows.length) setSyncMsg('No transactions found in that screenshot.')
      else setCandidates(rows)
    } catch (err) {
      setSyncMsg(`Screenshot read failed: ${err}`)
    } finally {
      setImporting(false)
      if (shotInput.current) shotInput.current.value = ''
    }
  }

  async function handleConfirmImport(rows: FinanceTransaction[]) {
    await ensureLocal(shotAccount)
    const n = await insertTransactions(rows)
    setSyncMsg(`Imported ${n} of ${rows.length} transactions`)
    setCandidates(null)
    await load()
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
    // The servicer name is user data, never a constant here. Prefer the name
    // already on the latest row, then the configured one, and only ask when
    // neither exists — the name is the upsert key, so a typo starts a second
    // servicer that the net-worth rollup would add on top of the first.
    const servicer =
      loan?.servicer ?? settings?.loan_servicer ?? window.prompt('Loan servicer name:')?.trim()
    if (!servicer) return
    const raw = window.prompt(`${servicer} loan balance ($):`, loan ? String(loan.balance) : '')
    if (raw == null) return
    const v = parseFloat(raw.replace(/[$,]/g, ''))
    if (Number.isNaN(v)) return
    await setManualLoan(v, servicer)
    await load()
  }

  async function handleCreateRule(rule: NewRule) {
    await upsertRuleByMatch(rule)
    setRules(await getRules())
  }

  async function handleDeleteRule(id: number) {
    await deleteRule(id)
    setRules(await getRules())
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
        <Link to="/" className="finance__back">Home</Link>
      </header>

      <section className="finance__bar">
        <button className="finance__btn" onClick={handleSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        <PlaidLinkButton onLinked={load} />
        <span className="finance__shot">
          <select className="finance__sel" value={shotAccount} onChange={(e) => setShotAccount(e.target.value)}>
            {LOCAL_ACCOUNTS.map((a) => <option key={a.account_id} value={a.account_id}>{a.name}</option>)}
          </select>
          <button className="finance__ghostBtn" onClick={() => shotInput.current?.click()} disabled={importing}>
            {importing ? 'Reading…' : 'Add from screenshot'}
          </button>
          <input ref={shotInput} type="file" accept="image/*" multiple hidden onChange={handleScreenshot} />
        </span>
        {settings?.last_full_sync_date && <span className="finance__synced">last sync {settings.last_full_sync_date}</span>}
      </section>
      {syncMsg && <p className="finance__syncMsg">{syncMsg}</p>}

      {loading ? (
        <p className="finance__empty" style={{ textAlign: 'center', padding: '40px 0' }}>Loading…</p>
      ) : accounts.length === 0 && txns.length === 0 ? (
        <section className="dash__card">
          <p className="finance__empty">No accounts yet. Connect a bank with Plaid, or add transactions from a screenshot to get started.</p>
        </section>
      ) : (
        <>
          <MonthlySummary
            monthLabel={prettyMonth(month)}
            flow={flow}
            prior={priorFlow}
            savings={savings}
            subItems={subItems}
            pendingReview={review.length}
            onPrev={() => setMonth((m) => prevMonthKey(m))}
            onNext={() => setMonth((m) => nextMonthKey(m))}
            canNext={month < currentMonth}
          />

          <ReviewQueue items={review} onApprove={handleApprove} onEdit={setEditing} />

          <section className="dash__card">
            <div className="dash__cardHeader"><h2>Net worth</h2><span className="muted">balance over time</span></div>
            <NetWorthChart snapshots={snapshots} accounts={accounts} balances={balanceHistory} />
          </section>

          <section className="dash__card">
            <div className="dash__cardHeader"><h2>Cash flow</h2><span className="muted">{prettyMonth(month)} · spending + savings</span></div>
            <CashFlowChart flow={flow} income={income} savings={savings} />
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
              <span>{loan?.servicer ?? settings?.loan_servicer ?? 'Loan'}: <strong>{loan ? money(loan.balance) : 'not set'}</strong>{loan ? ` (${loan.source})` : ''}</span>
              <button className="finance__ghostBtn finance__ghostBtn--sm" onClick={handleManualLoan}>Set manually</button>
            </div>
          </section>

          <section className="dash__card">
            <div className="dash__cardHeader">
              <h2>Transactions</h2>
              <button className="finance__ghostBtn finance__ghostBtn--sm" onClick={() => setShowAll(true)}>See all</button>
            </div>
            <span className="muted">{prettyMonth(month)}</span>
            <TransactionList items={monthTxns} onEdit={setEditing} />
          </section>

          <section className="dash__card">
            <div className="dash__cardHeader"><h2>Rules</h2><span className="muted">{rules.length} active</span></div>
            <p className="finance__hint">Create rules by opening a transaction and ticking “Always classify … from now on”. Each rule auto-applies to future matching transactions on sync and screenshot import.</p>
            {rules.length === 0 ? (
              <p className="finance__empty">No rules yet.</p>
            ) : (
              <div className="finance__rules">
                {rules.map((r) => (
                  <div className="finance__rule" key={r.id}>
                    <div className="finance__ruleInfo">
                      <span className="finance__ruleMatch">“{r.match_text}”</span>
                      <span className="finance__ruleMeta">→ {CATEGORY_LABELS[r.category]}{r.note ? ` · ${r.note}` : ''}</span>
                    </div>
                    <button className="finance__ghostBtn finance__ghostBtn--sm finance__ghostBtn--danger" onClick={() => handleDeleteRule(r.id)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {editing && (
        <TransactionEditor
          txn={editing}
          accountName={accountName(editing.account_id)}
          onSave={handleSave}
          onClose={() => setEditing(null)}
          onDelete={handleDelete}
          onCreateRule={handleCreateRule}
          brokerageMatch={parseBrokerageMatch(settings?.brokerage_match)}
        />
      )}

      {showAll && (
        <AllTransactions onEdit={(t) => { setShowAll(false); setEditing(t) }} onClose={() => setShowAll(false)} />
      )}

      {candidates && (
        <ImportReview
          candidates={candidates}
          onConfirm={handleConfirmImport}
          onClose={() => setCandidates(null)}
        />
      )}
    </main>
  )
}
