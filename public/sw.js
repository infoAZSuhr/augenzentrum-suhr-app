const CACHE = 'azs-v4'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return

  // Only handle same-origin requests – skip Firebase, Firestore, Google APIs etc.
  const url = new URL(e.request.url)
  if (url.origin !== self.location.origin) return

  // Navigation: network first, fall back to cached index.html (SPA offline support)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const clone = r.clone()  // clone SYNCHRONOUSLY before any async
          caches.open(CACHE).then(cache => cache.put(e.request, clone))
          return r
        })
        .catch(() => caches.match('/index.html'))
    )
    return
  }

  // Static assets: cache first, then network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached
      return fetch(e.request).then(r => {
        if (r.ok) {
          const clone = r.clone()  // clone SYNCHRONOUSLY before returning r
          caches.open(CACHE).then(cache => cache.put(e.request, clone))
        }
        return r
      })
    })
  )
})
