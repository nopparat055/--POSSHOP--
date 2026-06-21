const CACHE_NAME = 'nok-pos-cache-v1';
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/sweetalert2@11',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://www.orangefreesounds.com/wp-content/uploads/2021/05/Line-message-tone.mp3'
];

// Install Service Worker and cache essential assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[Service Worker] Precaching app shell and CDNs');
        // We use map and catch to ensure that if one resource fails (e.g. offline during install),
        // the remaining files are still successfully cached.
        return Promise.allSettled(
          PRECACHE_ASSETS.map((asset) => {
            return cache.add(asset).catch((err) => {
              console.warn(`[Service Worker] Failed to cache asset: ${asset}`, err);
            });
          })
        );
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Service Worker and clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event interceptor
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // Bypass cache for Google Sheets Sync (script.google.com) and non-GET requests
  if (requestUrl.hostname.includes('script.google.com') || event.request.method !== 'GET') {
    return; // Let browser handle it directly via network
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // If found in cache, return it immediately
        // For local assets or CDN, fetch in background to update cache (Stale-While-Revalidate)
        fetch(event.request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch((err) => {
          // Silent catch for background fetch errors when offline
        });

        return cachedResponse;
      }

      // If not in cache, fetch from network
      return fetch(event.request).then((networkResponse) => {
        // Only cache valid GET responses from HTTP/HTTPS
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'error') {
          return networkResponse;
        }

        // Cache the newly requested asset (like dynamic webfonts from font-awesome)
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch((error) => {
        // Optional: return offline fallback if request is for index.html or document navigation
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        throw error;
      });
    })
  );
});
