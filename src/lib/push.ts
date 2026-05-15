import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushSupportState =
  | { ok: true }
  | { ok: false; reason: 'no-api' | 'not-installed' | 'no-vapid' }

/**
 * iOS Web Push only works when the site has been added to the home screen
 * and opened as a standalone PWA. Inside a Safari tab the APIs may exist
 * but `pushManager.subscribe` will fail. We surface this up-front so the UI
 * can tell the user to install first.
 */
export function pushSupport(): PushSupportState {
  if (typeof window === 'undefined') return { ok: false, reason: 'no-api' }
  const hasApis =
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  if (!hasApis) return { ok: false, reason: 'no-api' }

  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  if (!standalone) return { ok: false, reason: 'not-installed' }

  if (!VAPID_PUBLIC_KEY) return { ok: false, reason: 'no-vapid' }
  return { ok: true }
}

export async function getSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

export async function subscribe(): Promise<PushSubscription> {
  if (!VAPID_PUBLIC_KEY) throw new Error('Missing VITE_VAPID_PUBLIC_KEY')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission denied')

  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  if (existing) {
    await persist(existing)
    return existing
  }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  })
  await persist(sub)
  return sub
}

export async function unsubscribe(): Promise<void> {
  const sub = await getSubscription()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}

async function persist(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON()
  const { endpoint, keys } = json as { endpoint: string; keys?: { p256dh: string; auth: string } }
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    throw new Error('Invalid subscription — missing keys')
  }
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ endpoint, p256dh: keys.p256dh, auth: keys.auth }, { onConflict: 'endpoint' })
  if (error) throw error
}

// VAPID public keys are URL-safe base64; the browser API wants a raw byte array.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}
