import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getSettings, updateSettings, PushSettings } from '../lib/settings'
import { getSubscription, pushSupport, subscribe, unsubscribe } from '../lib/push'
import './Settings.css'

type Status = 'idle' | 'saving' | 'subscribing' | 'unsubscribing'

export default function Settings() {
  const [settings, setSettings] = useState<PushSettings | null>(null)
  const [subscribed, setSubscribed] = useState<boolean>(false)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const support = pushSupport()

  useEffect(() => {
    let cancelled = false
    Promise.all([getSettings(), getSubscription()])
      .then(([s, sub]) => {
        if (cancelled) return
        setSettings(s)
        setSubscribed(!!sub)
      })
      .catch((e) => {
        console.error('[settings]', e)
        if (!cancelled) setError('Couldn’t load settings.')
      })
    return () => { cancelled = true }
  }, [])

  async function toggleSubscribed(next: boolean) {
    setError(null)
    setStatus(next ? 'subscribing' : 'unsubscribing')
    try {
      if (next) {
        await subscribe()
        setSubscribed(true)
      } else {
        await unsubscribe()
        setSubscribed(false)
      }
    } catch (e) {
      console.error('[settings] subscription', e)
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setStatus('idle')
    }
  }

  async function patchSettings(patch: Partial<PushSettings>) {
    if (!settings) return
    const optimistic = { ...settings, ...patch }
    setSettings(optimistic)
    setStatus('saving')
    setError(null)
    try {
      const saved = await updateSettings(patch)
      setSettings(saved)
    } catch (e) {
      console.error('[settings] save', e)
      setError('Couldn’t save — try again.')
    } finally {
      setStatus('idle')
    }
  }

  return (
    <main className="settings">
      <header className="settings__header">
        <Link to="/" className="settings__back">← Today</Link>
        <h1 className="settings__title">Settings</h1>
      </header>

      <section className="settings__card">
        <div className="settings__row">
          <div className="settings__rowText">
            <h2 className="settings__rowTitle">Daily reminders</h2>
            <p className="settings__rowHint">
              A push notification at your morning and evening times, but only if
              that check-in hasn’t been filled yet.
            </p>
          </div>
          <Toggle
            checked={subscribed}
            disabled={!support.ok || status !== 'idle'}
            onChange={toggleSubscribed}
          />
        </div>

        {!support.ok && <SupportBanner reason={support.reason} />}

        <div className="settings__times" aria-disabled={!subscribed}>
          <label className="settings__field">
            <span>Morning</span>
            <input
              type="time"
              value={settings?.morning_time ?? '08:00'}
              disabled={!settings}
              onChange={(e) => patchSettings({ morning_time: e.target.value })}
            />
          </label>
          <label className="settings__field">
            <span>Evening</span>
            <input
              type="time"
              value={settings?.evening_time ?? '21:30'}
              disabled={!settings}
              onChange={(e) => patchSettings({ evening_time: e.target.value })}
            />
          </label>
        </div>

        <p className="settings__tz">
          Times are in <strong>{settings?.timezone ?? 'America/Denver'}</strong>.
          Reminders may arrive up to 5 minutes after the scheduled time.
        </p>
      </section>

      <section className="settings__card">
        <div className="settings__row">
          <div className="settings__rowText">
            <h2 className="settings__rowTitle">Gym rest budget</h2>
            <p className="settings__rowHint">
              How many rest days per week before the streak resets. Counted Mon–Sun.
            </p>
          </div>
        </div>

        <label className="settings__field">
          <span>Rest days per week</span>
          <input
            type="number"
            min={0}
            max={7}
            step={1}
            value={settings?.rest_days_per_week ?? 3}
            disabled={!settings}
            onChange={(e) => {
              const n = Math.max(0, Math.min(7, Math.round(Number(e.target.value) || 0)))
              patchSettings({ rest_days_per_week: n })
            }}
          />
        </label>
      </section>

      {error && <p className="settings__error">{error}</p>}
    </main>
  )
}

function Toggle({
  checked,
  disabled,
  onChange
}: {
  checked: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      className={`toggle ${checked ? 'toggle--on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__thumb" />
    </button>
  )
}

function SupportBanner({ reason }: { reason: 'no-api' | 'not-installed' | 'no-vapid' }) {
  if (reason === 'not-installed') {
    return (
      <p className="settings__banner">
        On iPhone, push notifications only work after you tap{' '}
        <strong>Share → Add to Home Screen</strong> and open Ember from the icon.
      </p>
    )
  }
  if (reason === 'no-vapid') {
    return (
      <p className="settings__banner">
        Push isn’t configured yet — the VAPID public key is missing.
      </p>
    )
  }
  return (
    <p className="settings__banner">
      This browser doesn’t support web push. Try Safari on iOS 16.4+ or a recent
      Chrome/Edge.
    </p>
  )
}
