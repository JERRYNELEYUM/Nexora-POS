/* Nexora POS service worker — offline app shell.
   Bump VERSION whenever you redeploy a changed index.html so tills pick it up. */
const VERSION = 'nexora-pos-v6';
const SHELL = VERSION + '-shell';
const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isCacheable(res) {
  return res && res.ok;
}

// Network first, but fall back to the cached copy after a few seconds (slow/absent data).
function networkFirst(request) {
  return new Promise((resolve) => {
    let settled = false;
    const fromCache = () =>
      caches.match(request, { ignoreSearch: true }).then((hit) => {
        if (hit) return hit;
        const url = new URL(request.url);
        if (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) {
          return caches.match('index.html');
        }
        return undefined;
      });
    const timer = setTimeout(() => {
      fromCache().then((hit) => { if (hit && !settled) { settled = true; resolve(hit); } });
    }, NAV_TIMEOUT_MS);
    fetch(request)
      .then((res) => {
        clearTimeout(timer);
        if (isCacheable(res)) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => {});
        }
        if (!settled) { settled = true; resolve(res); }
      })
      .catch(() => {
        clearTimeout(timer);
        fromCache().then((hit) => {
          if (settled) return;
          settled = true;
          resolve(hit || new Response('Offline', { status: 503, statusText: 'Offline' }));
        });
      });
  });
}

// Serve from cache immediately, refresh in the background.
function staleWhileRevalidate(request) {
  return caches.open(SHELL).then((cache) =>
    cache.match(request).then((hit) => {
      const refresh = fetch(request)
        .then((res) => { if (isCacheable(res)) cache.put(request, res.clone()); return res; })
        .catch(() => hit);
      return hit || refresh;
    })
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                        // sync pushes are POSTs: never touched
  const url = new URL(req.url);
  if (url.pathname.indexOf('/.netlify/functions/') !== -1) return;   // backend calls go straight to network
  if (url.origin !== self.location.origin) return;         // ignore other origins

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }
  event.respondWith(staleWhileRevalidate(req));
});
