const CACHE = 'happy-v2';

const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Only handle same-origin or CDN requests; skip Google Maps API
  if (url.hostname.includes('maps.googleapis.com') || url.hostname.includes('maps.gstatic.com')) return;

  // HTML is served network-first. Cache-first on a document means a page stays
  // frozen at whatever version a visitor first loaded, and since a document is
  // what points at the hashed script and style files, those stay frozen with
  // it — a deploy would never reach anyone who had already visited. The cached
  // copy is still the offline fallback.
  const isDoc = request.mode === 'navigate' ||
    (request.headers.get('accept') || '').includes('text/html');
  if (isDoc) {
    e.respondWith(
      fetch(request).then(res => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
        }
        return res;
      }).catch(() => caches.match(request).then(
        cached => cached || new Response('Offline', { status: 503 })
      ))
    );
    return;
  }

  // Everything else is cache-first: build outputs carry a content hash in the
  // filename, so a changed file is a different URL and can never go stale.
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (!res || res.status !== 200 || res.type === 'opaque') return res;
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(request, clone));
        return res;
      }).catch(() => cached || new Response('Offline', { status: 503 }));
    })
  );
});
