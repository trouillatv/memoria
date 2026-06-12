/* Retired service worker.
 *
 * MemorIA no longer uses a service worker, but browsers that previously
 * registered /sw.js keep the old worker alive until they can install a new
 * script from the same URL. This script intentionally has no fetch handler:
 * navigation requests must go directly to Next.js.
 */

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames.map((name) => caches.delete(name)))

    await clients.claim()
    await self.registration.unregister()

    const windows = await clients.matchAll({ type: 'window' })
    await Promise.all(windows.map((client) => client.navigate(client.url)))
  })())
})
