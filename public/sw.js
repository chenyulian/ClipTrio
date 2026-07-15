const CACHE_PREFIX = 'cliptrio-ffmpeg-runtime-';
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const RUNTIME_ASSETS = new Set([
  new URL('./vendor/ffmpeg-core/ffmpeg-core.js', self.registration.scope).href,
  new URL('./vendor/ffmpeg-core/ffmpeg-core.wasm', self.registration.scope).href
]);

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !RUNTIME_ASSETS.has(event.request.url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;

    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  })());
});
