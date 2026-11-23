const CACHE_NAME = 'football-community-v20';
const CORE_ASSETS = [
  './',
  './index.html',
  './promo.html',
  './fc-data.js',
  './manifest.json',
  './img/icon-192.png',
  './img/icon-512.png',
  './img/apple-touch-icon.png',
  './img/venue1.jpg',
  './img/venue2.jpg',
  './img/venue3.jpg',
  './img/game1.jpg',
  './img/event1.jpg',
  './img/event2.jpg',
  './img/event3.jpg',
  './img/event4.jpg',
  './audio/vo1.m4a',
  './audio/vo2.m4a',
  './audio/vo3.m4a',
  './audio/vo4.m4a',
  './audio/vo5.m4a'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('posthog.com')
  ) {
    return;
  }

  // Network-first for HTML and JS so code updates appear immediately
  if (
    req.mode === 'navigate' ||
    req.destination === 'document' ||
    req.destination === 'script' ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.html')
  ) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first for images and icons
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
