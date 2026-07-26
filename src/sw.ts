/// <reference lib="WebWorker" />
import { clientsClaim } from 'workbox-core'
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { NetworkFirst, NetworkOnly } from 'workbox-strategies'

declare const self: ServiceWorkerGlobalScope

// Without these, a new deploy's SW sits "waiting" until every open client
// fully closes. iOS backgrounds the home-screen PWA instead of closing it,
// so it can be stuck on a stale bundle indefinitely — activate immediately
// and take control so `registerType: 'autoUpdate'` actually reloads clients.
self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)

// Mirror the runtime caching rules that previously lived in vite.config.ts.
registerRoute(({ url }) => url.pathname.startsWith('/api/'), new NetworkOnly())
registerRoute(
  ({ url }) => url.hostname.endsWith('.supabase.co'),
  new NetworkFirst({ cacheName: 'supabase', networkTimeoutSeconds: 5 })
)

interface PushPayload {
  title: string
  body: string
  tag?: string
  url?: string
}

self.addEventListener('push', (event) => {
  const data: PushPayload = (() => {
    try {
      return event.data?.json() as PushPayload
    } catch {
      return { title: 'Ember', body: 'Time for a check-in.' }
    }
  })()

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/apple-touch-icon.png',
      badge: '/apple-touch-icon.png',
      // Use the slot name as the tag so a fresh morning push replaces any
      // lingering one instead of stacking. Same for evening.
      tag: data.tag,
      data: { url: data.url ?? '/' }
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/'
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // If the PWA is already open, focus that tab/window and navigate it.
      for (const client of all) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client) await client.navigate(url).catch(() => {})
          return
        }
      }
      await self.clients.openWindow(url)
    })()
  )
})
