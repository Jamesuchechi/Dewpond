const CACHE_PREFIX = 'dewpond-offline-';
const MANIFEST_URL = new URL('./precache-manifest.json', self.location.href).href;

let cachedCount = 0;
let netFetchCount = 0;
let externalBlockedCount = 0;

async function broadcastStatus() {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  const payload = {
    type: 'SW_STATUS',
    ready: true,
    cachedCount,
    netFetchCount,
    externalBlockedCount,
  };
  for (const client of clients) {
    client.postMessage(payload);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
        if (!res.ok) {
          self.skipWaiting();
          return;
        }
        const manifest = await res.json();
        const cacheName = `${CACHE_PREFIX}${manifest.version || 'v1'}`;
        const cache = await caches.open(cacheName);
        const urls = Array.isArray(manifest.assets) ? manifest.assets : [];

        for (const rel of urls) {
          const abs = new URL(rel, self.location.href).href;
          try {
            await cache.add(abs);
            cachedCount += 1;
          } catch {
            // Skip missing optional paths (e.g., dev server)
          }
        }
      } catch {
        // Manifest absent in Vite dev mode; install cleanly without blocking
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      let currentCache = null;
      for (const name of names) {
        if (name.startsWith(CACHE_PREFIX)) {
          currentCache = name;
        }
      }
      // Keep only the newest cache when multiple exist
      const sorted = names.filter((n) => n.startsWith(CACHE_PREFIX)).sort();
      for (let i = 0; i < sorted.length - 1; i++) {
        await caches.delete(sorted[i]);
      }
      currentCache = sorted[sorted.length - 1] ?? currentCache;
      if (currentCache) {
        const cache = await caches.open(currentCache);
        const keys = await cache.keys();
        cachedCount = keys.length;
      }
      await self.clients.claim();
      await broadcastStatus();
    })(),
  );
});

async function matchFromCache(request) {
  const reqUrl = new URL(request.url);
  if (request.mode === 'navigate' || !reqUrl.search) {
    const direct = await caches.match(request, { ignoreSearch: true, ignoreVary: true });
    if (direct) return direct;

    const byUrl = await caches.match(request.url, { ignoreSearch: true, ignoreVary: true });
    if (byUrl) return byUrl;
  } else {
    const exact = await caches.match(request, { ignoreVary: true });
    if (exact) return exact;
  }

  if (request.mode === 'navigate') {
    if (reqUrl.pathname.endsWith('/app') || reqUrl.pathname.endsWith('/app/')) {
      const appFallback = await caches.match(new URL('./app/index.html', self.location.href).href);
      if (appFallback) return appFallback;
    }
    const rootFallback = await caches.match(new URL('./index.html', self.location.href).href);
    if (rootFallback) return rootFallback;
  }
  return undefined;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    externalBlockedCount += 1;
    void broadcastStatus();
    event.respondWith(Response.error());
    return;
  }

  // Bypass Vite dev server HMR, prebundled deps, and source module requests cleanly
  if (
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/') ||
    url.searchParams.has('v') ||
    url.searchParams.has('t') ||
    url.searchParams.has('token')
  ) {
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await matchFromCache(req);
      if (cached) {
        return cached;
      }

      const response = await fetch(req);
      netFetchCount += 1;
      if (response.ok && response.type === 'basic') {
        const names = (await caches.keys()).filter((n) => n.startsWith(CACHE_PREFIX)).sort();
        const targetName = names[names.length - 1] ?? `${CACHE_PREFIX}runtime`;
        const cache = await caches.open(targetName);
        await cache.put(req, response.clone());
        cachedCount = (await cache.keys()).length;
      }
      void broadcastStatus();
      return response;
    })(),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'SW_PING') {
    event.waitUntil(broadcastStatus());
  } else if (data.type === 'SW_WIPE') {
    event.waitUntil(
      (async () => {
        const names = await caches.keys();
        for (const name of names) {
          if (name.startsWith(CACHE_PREFIX)) {
            await caches.delete(name);
          }
        }
        cachedCount = 0;
        netFetchCount = 0;
        await broadcastStatus();
      })(),
    );
  }
});
