/* Nutrition service worker: offline-first app shell. Refresh with `python3 tools/build.py sw`. */
const VERSION = 'nutrition-dda9f40852';
const ASSETS = ["./", "index.html", "app.js", "app.css", "seed.json", "manifest.webmanifest", "fonts/fonts.css", "fonts/archivo-variable-latin.woff2", "icons/apple-touch-icon.png", "icons/favicon-48.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('index.html').then((hit) => hit || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  })));
});
