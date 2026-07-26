const CACHE_NAME = 'seikoyt-cache-v5';
const DOWNLOADS_CACHE_NAME = 'seikotv-downloads';
const ASSETS_TO_CACHE = [
  '/',
  '/manifest.json',
  'https://59m37zkauy.ucarecd.net/6449ac81-e76b-4b61-bddb-52b4d8f8a27f/AirbrushIMAGEENHANCER177165941446117716594144612.jpg',
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Montserrat:wght@400;500;700&display=swap',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== DOWNLOADS_CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isVideo = url.pathname.endsWith('.mp4') || url.pathname.endsWith('.m3u8');

  if (isVideo) {
    event.respondWith(
      caches.match(event.request, { cacheName: DOWNLOADS_CACHE_NAME }).then((response) => {
        if (response) {
          return response;
        }
        return fetch(event.request).catch(() => {
          return caches.match(event.request);
        });
      })
    );
  } else if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    // Network-First strategy for HTML navigation to ensure latest bundle references are served
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request) || caches.match('/'))
    );
  } else {
    // Cache first, fallback to network
    event.respondWith(
      caches.match(event.request).then((response) => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
    );
  }
});
