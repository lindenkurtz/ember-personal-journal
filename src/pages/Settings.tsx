import { useEffect, useState } from 'react'
import { getSettings, updateSettings, setRestBudget, PushSettings } from '../lib/settings'
import { getSubscription, pushSupport, subscribe, unsubscribe } from '../lib/push'
import { resetAppCaches } from '../lib/swUpdate'
import PageHeader from '../components/PageHeader'
import './Settings.css'

type Status = 'idle' | 'saving' | 'subscribing' | 'unsubscribing'

export default function Settings() {
  const [settings, setSettings] = useState<PushSettings | null>(null)
  const [subscribed, setSubscribed] = useState<boolean>(false)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
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
        if (!cancelled) setError("Couldn't load settings.")
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

  async function resetCaches() {
    setResetting(true)
    setError(null)
    try {
      // Resolves into a reload, so `resetting` is only cleared on failure.
      await resetAppCaches()
    } catch (e) {
      console.error('[settings] reset', e)
      setError("Couldn't clear the cache — try again.")
      setResetting(false)
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
      setError("Couldn't save — try again.")
    } finally {
      setStatus('idle')
    }
  }

  async function changeRestBudget(next: number) {
    if (!settings) return
    const clamped = Math.max(0, Math.min(7, Math.round(next)))
    if (clamped === settings.rest_days_per_week) return
    const optimistic = { ...settings, rest_days_per_week: clamped }
    setSettings(optimistic)
    setStatus('saving')
    setError(null)
    try {
      const saved = await setRestBudget(settings, clamped)
      setSettings(saved)
    } catch (e) {
      console.error('[settings] rest budget', e)
      setError("Couldn't save — try again.")
    } finally {
      setStatus('idle')
    }
  }

  return (
    <main className="page settings">
      <PageHeader title="Settings" subtitle="Reminders, streak rules, and app data." />

      <section className="card">
        <div className="settings__row">
          <div className="settings__rowText">
            <h2 className="card__title">Reminders</h2>
            <p className="settings__rowHint">
              A push notification at your morning and evening times, but only if
              that check-in hasn't been filled yet — plus a Sunday reminder to
              log last week's screen time.
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
          <label className="settings__field">
            <span>Screen time (Sun)</span>
            <input
              type="time"
              value={settings?.weekly_time ?? '21:00'}
              disabled={!settings}
              onChange={(e) => patchSettings({ weekly_time: e.target.value })}
            />
          </label>
        </div>

        <p className="settings__tz">
          Times are in <strong>{settings?.timezone ?? 'America/Denver'}</strong>.
          Reminders may arrive up to 5 minutes after the scheduled time.
        </p>
      </section>

      <section className="card">
        <div className="settings__row">
          <div className="settings__rowText">
            <h2 className="card__title">Gym rest budget</h2>
            <p className="settings__rowHint">
              How many rest days per week before the streak resets. Counted Mon–Sun.
            </p>
          </div>
        </div>

        <div className="settings__field">
          <span>Rest days per week</span>
          <div className="settings__stepper">
            <button
              type="button"
              className="settings__stepperBtn"
              aria-label="Decrease rest days"
              disabled={!settings || status === 'saving' || (settings?.rest_days_per_week ?? 0) <= 0}
              onClick={() => changeRestBudget((settings?.rest_days_per_week ?? 0) - 1)}
            >
              −
            </button>
            <span className="settings__stepperValue" aria-live="polite">
              {settings?.rest_days_per_week ?? 3}
            </span>
            <button
              type="button"
              className="settings__stepperBtn"
              aria-label="Increase rest days"
              disabled={!settings || status === 'saving' || (settings?.rest_days_per_week ?? 7) >= 7}
              onClick={() => changeRestBudget((settings?.rest_days_per_week ?? 0) + 1)}
            >
              +
            </button>
          </div>
        </div>
      </section>

      <LocationSection
        settings={settings}
        onLabel={(v) => patchSettings({ location_name: v || null })}
        onCoords={(lat, lon) => patchSettings({ latitude: lat, longitude: lon })}
      />

      <section className="card">
        <div className="settings__row">
          <div className="settings__rowText">
            <h2 className="card__title">App cache</h2>
            <p className="settings__rowHint">
              Still on an old version after a deploy? This clears the cached app
              and reloads from the server. Entries live in the database, so
              nothing is lost and reminders stay on.
            </p>
          </div>
        </div>

        <button
          type="button"
          className="settings__reset"
          onClick={resetCaches}
          disabled={resetting}
        >
          {resetting ? 'Clearing…' : 'Reset app data'}
        </button>
      </section>

      {error && <p className="settings__error">{error}</p>}
    </main>
  )
}

function LocationSection({
  settings,
  onLabel,
  onCoords
}: {
  settings: PushSettings | null
  onLabel: (v: string) => void
  onCoords: (lat: number, lon: number) => void
}) {
  const [detectError, setDetectError] = useState<string | null>(null)
  const [detecting, setDetecting] = useState(false)

  function detect() {
    if (!('geolocation' in navigator)) {
      setDetectError("Geolocation isn't available in this browser.")
      return
    }
    setDetectError(null)
    setDetecting(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onCoords(
          Number(pos.coords.latitude.toFixed(6)),
          Number(pos.coords.longitude.toFixed(6))
        )
        setDetecting(false)
      },
      () => {
        setDetectError("Couldn't detect location — check your browser permissions.")
        setDetecting(false)
      },
      { timeout: 10000 }
    )
  }

  const lat = settings?.latitude
  const lon = settings?.longitude
  const hasCoords = lat != null && lon != null

  return (
    <section className="card">
      <div className="settings__row">
        <div className="settings__rowText">
          <h2 className="card__title">Location</h2>
          <p className="settings__rowHint">
            Used silently to attach weather to your daily entries. A free-text
            label is just for your reference; coordinates power the weather lookup.
          </p>
        </div>
      </div>

      <label className="settings__field">
        <span>Label</span>
        <input
          type="text"
          placeholder="e.g. your city"
          value={settings?.location_name ?? ''}
          disabled={!settings}
          onChange={(e) => onLabel(e.target.value)}
        />
      </label>

      <div className="settings__detectRow">
        <button
          type="button"
          className="settings__detect"
          onClick={detect}
          disabled={!settings || detecting}
        >
          {detecting ? 'Detecting…' : 'Detect automatically'}
        </button>
        {hasCoords && (
          <p className="settings__rowHint">
            Current: {lat!.toFixed(4)}, {lon!.toFixed(4)}
          </p>
        )}
      </div>

      {detectError && <p className="settings__error">{detectError}</p>}
    </section>
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
        Push isn't configured yet — the VAPID public key is missing.
      </p>
    )
  }
  return (
    <p className="settings__banner">
      This browser doesn't support web push. Try Safari on iOS 16.4+ or a recent
      Chrome/Edge.
    </p>
  )
}
