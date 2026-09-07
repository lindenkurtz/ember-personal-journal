import { registerSW } from 'virtual:pwa-register'

// iOS never closes a home-screen PWA — it suspends the page and resumes the
// same one — so the single update check `registerSW` runs at load can be the
// only check the app ever performs, and a deploy sits undiscovered for as long
// as the PWA stays installed. Re-check whenever it returns to the foreground,
// regains the network, or has been foregrounded for an hour.

const FOREGROUND_RECHECK_MS = 60 * 60 * 1000
// A resume can fire more than once in quick succession; don't refetch sw.js
// every time the user glances at the app.
const MIN_GAP_MS = 60 * 1000

let registration: ServiceWorkerRegistration | null = null
let lastCheck = 0
let holds = 0
let deferred = false

function check() {
  if (!registration) return
  // A found update activates immediately (src/sw.ts calls skipWaiting) and
  // vite-plugin-pwa's autoUpdate then reloads the page, discarding whatever the
  // holder has unsaved. Remember the skipped check and run it on release.
  if (holds > 0) {
    deferred = true
    return
  }
  if (Date.now() - lastCheck < MIN_GAP_MS) return
  lastCheck = Date.now()
  deferred = false
  registration.update().catch(() => {})
}

/**
 * Suppress update checks — and so the reload that follows one — while the
 * caller holds unsaved input. Returns its release function, so a page can hold
 * for its whole lifetime with `useEffect(holdUpdates, [])`.
 */
export function holdUpdates(): () => void {
  holds += 1
  return () => {
    holds -= 1
    if (holds === 0 && deferred) check()
  }
}

export function registerServiceWorker() {
  // Auto-update silently: single user, no need to prompt.
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, r) {
      if (!r) return
      registration = r
      // Registration just checked; don't immediately repeat on first resume.
      lastCheck = Date.now()
    }
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
  window.addEventListener('online', check)
  setInterval(() => {
    if (document.visibilityState === 'visible') check()
  }, FOREGROUND_RECHECK_MS)
}
