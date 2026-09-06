import { useEffect, useState } from 'react'
import { usePlaidLink } from 'react-plaid-link'
import { createPlaidLinkToken, exchangePublicToken } from '../../lib/finance/plaid'

interface Props {
  onLinked: () => void
}

/**
 * Opens Plaid Link. We fetch a fresh link_token on click, then auto-open once
 * the SDK is ready. redirect_uri is the deployed /finance URL so OAuth banks
 * (banks that use an OAuth handoff) can hand the session back.
 */
export default function PlaidLinkButton({ onLinked }: Props) {
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { open, ready } = usePlaidLink({
    token,
    onSuccess: async (publicToken, metadata) => {
      try {
        await exchangePublicToken(publicToken, metadata.institution?.name ?? undefined)
        onLinked()
      } catch (e) {
        setError(String(e))
      } finally {
        setToken(null)
        setBusy(false)
      }
    },
    onExit: () => {
      setToken(null)
      setBusy(false)
    }
  })

  useEffect(() => {
    if (token && ready) open()
  }, [token, ready, open])

  async function start() {
    setBusy(true)
    setError(null)
    try {
      // redirect_uri must be pre-registered in the Plaid dashboard and is only
      // needed for OAuth banks. Skip it on localhost so Sandbox testing works
      // without dashboard config.
      const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)
      const t = await createPlaidLinkToken(isLocal ? undefined : `${window.location.origin}/finance`)
      if (!t) throw new Error('no link token (Plaid not configured?)')
      setToken(t)
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <div className="finance__connect">
      <button className="finance__btn" onClick={start} disabled={busy}>
        {busy ? 'Connecting…' : 'Connect account'}
      </button>
      {error && <span className="finance__error">{error}</span>}
    </div>
  )
}
