import { useEffect, useState } from 'react'
import type { FinanceAccount, FinanceBalance, FinanceSettings, LoanBalance, NetWorthSnapshot } from '../../shared/finance/types'
import { getAccounts, updateAccount } from '../lib/finance/accounts'
import { getLatestBalances, getBalanceHistory, getNetWorthSnapshots } from '../lib/finance/balances'
import { getFinanceSettings } from '../lib/finance/settings'
import { getLatestLoan, setManualLoan } from '../lib/finance/loans'
import { runPlaidSync } from '../lib/finance/plaid'
import { money } from '../lib/finance/format'
import PageHeader from '../components/PageHeader'
import PlaidLinkButton from '../components/finance/PlaidLinkButton'
import NetWorthChart from '../components/finance/NetWorthChart'
import './Finance.css'

export default function Finance() {
  const [accounts, setAccounts] = useState<FinanceAccount[]>([])
  const [balances, setBalances] = useState<Map<string, FinanceBalance>>(new Map())
  const [balanceHistory, setBalanceHistory] = useState<FinanceBalance[]>([])
  const [snapshots, setSnapshots] = useState<NetWorthSnapshot[]>([])
  const [settings, setSettings] = useState<FinanceSettings | null>(null)
  const [loan, setLoan] = useState<LoanBalance | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  async function load() {
    const [acc, bal, hist, snaps, set, ln] = await Promise.all([
      getAccounts(),
      getLatestBalances(),
      getBalanceHistory(),
      getNetWorthSnapshots(),
      getFinanceSettings(),
      getLatestLoan()
    ])
    setAccounts(acc)
    setBalances(bal)
    setBalanceHistory(hist)
    setSnapshots(snaps)
    setSettings(set)
    setLoan(ln)
  }

  useEffect(() => {
    let cancelled = false
    load()
      .catch((e) => console.error('[finance]', e))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const latestSnapshot = snapshots.length ? snapshots[snapshots.length - 1] : null

  async function handleSync() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const s = await runPlaidSync()
      setSyncMsg(`Synced ${s.accounts} accounts${s.errors.length ? ` · ${s.errors.length} errors` : ''}`)
      await load()
    } catch (e) {
      setSyncMsg(`Sync failed: ${e}`)
    } finally {
      setSyncing(false)
    }
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

  return (
    <main className="page finance">
      <PageHeader
        eyebrow="Finance"
        title={latestSnapshot ? money(latestSnapshot.net_worth) : '—'}
        subtitle={
          <>
            net worth
            {latestSnapshot && <> · {money(latestSnapshot.assets_total)} assets − {money(latestSnapshot.liabilities_total)} debt</>}
          </>
        }
      />

      <section className="finance__bar">
        <button className="finance__btn" onClick={handleSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
        <PlaidLinkButton onLinked={load} />
        {settings?.last_full_sync_date && <span className="finance__synced">last sync {settings.last_full_sync_date}</span>}
      </section>
      {syncMsg && <p className="finance__syncMsg">{syncMsg}</p>}

      {loading ? (
        <p className="finance__empty" style={{ textAlign: 'center', padding: '40px 0' }}>Loading…</p>
      ) : accounts.length === 0 ? (
        <section className="card">
          <p className="finance__empty">No accounts yet. Connect a bank with Plaid to start tracking net worth.</p>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="card__header"><h2>Net worth</h2><span className="muted">balance over time</span></div>
            <NetWorthChart snapshots={snapshots} accounts={accounts} balances={balanceHistory} />
          </section>

          <section className="card">
            <div className="card__header"><h2>Accounts</h2><span className="muted">tap to toggle net worth</span></div>
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
        </>
      )}
    </main>
  )
}
