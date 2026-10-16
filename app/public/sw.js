// App-shell cache: the UI opens offline. API calls are never cached (they carry private data).
const CACHE = 'makas-shell-v1';
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './icon.svg', './manifest.webmanifest'])));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      try {
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      } catch {
        return (await c.match(e.request)) || (await c.match('./index.html'));
      }
    }),
  );
});
