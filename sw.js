const SHELL_CACHE = 'tradingdesk-shell-v1'
const AUDIO_CACHE = 'tradingdesk-audio-v1'
const FONT_CACHE = 'tradingdesk-fonts-v1'
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/vendor/lightweight-charts.standalone.production.js',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png'
]

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('tradingdesk-shell-') && key !== SHELL_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  if (url.origin !== self.location.origin) {
    if (url.hostname !== 'fonts.googleapis.com' && url.hostname !== 'fonts.gstatic.com') return
    event.respondWith(caches.open(FONT_CACHE).then(async cache => {
      const cached = await cache.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok || response.type === 'opaque') await cache.put(request, response.clone())
      return response
    }).catch(async () => await caches.match(request) || Response.error()))
    return
  }

  if (url.pathname.startsWith('/api/')) return

  if (url.pathname.startsWith('/audio/')) {
    event.respondWith(caches.open(AUDIO_CACHE).then(async cache => {
      const cached = await cache.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok && response.status === 200) await cache.put(request, response.clone())
      return response
    }))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) caches.open(SHELL_CACHE).then(cache => cache.put('/index.html', response.clone()))
      return response
    }).catch(() => caches.match('/index.html')))
    return
  }

  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok && response.type === 'basic') caches.open(SHELL_CACHE).then(cache => cache.put(request, response.clone()))
    return response
  })))
})
