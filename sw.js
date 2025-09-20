// A robust service worker with a network-first strategy for core assets.
// It bypasses external APIs and ensures the app stays up-to-date.

const CORE_CACHE_NAME = 'deutschmeister-core-v1';
const STATIC_CACHE_NAME = 'deutschmeister-static-v1';
const ALL_CACHES = [CORE_CACHE_NAME, STATIC_CACHE_NAME];

// Assets that are critical for the app shell to function.
// These will be cached with a network-first strategy.
const CORE_ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/auth.js',
    '/firebase.js',
    '/quiz.js',
    '/youtube.js',
    '/translations.js',
    '/manifest.json'
];

// Static assets that don't change often.
// These will be cached with a cache-first strategy.
const STATIC_ASSETS = [
    '/icon.png',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,1,0'
];

// Domains to completely bypass in the service worker.
// The SW will not intercept requests to these domains.
const BYPASS_DOMAINS = [
    'youtube.com',
    'ytimg.com',
    'google.com',
    'googleapis.com',
    'gstatic.com',
    'firebaseapp.com',
    'netlify.app' // Add your production domain if different
];


// On install, pre-cache static assets and essential core assets for offline fallback.
self.addEventListener('install', (event) => {
    event.waitUntil(
        Promise.all([
            caches.open(STATIC_CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)),
            caches.open(CORE_CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS))
        ]).then(() => {
            console.log('Service Worker: All assets pre-cached.');
            return self.skipWaiting();
        })
    );
});

// On activation, clean up old caches to save space and prevent conflicts.
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.filter(cacheName => !ALL_CACHES.includes(cacheName))
                    .map(cacheName => caches.delete(cacheName))
            ).then(() => {
                console.log('Service Worker: Old caches cleared.');
                return self.clients.claim();
            });
        })
    );
});


// The main fetch handler with different strategies.
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // 1. Bypass requests to external domains (Firebase, Google APIs, YouTube) and non-GET requests.
    // This is critical to prevent the SW from interfering with their operations.
    const isBypassed = BYPASS_DOMAINS.some(domain => url.hostname.endsWith(domain));
    if (isBypassed || request.method !== 'GET') {
        return; // Let the browser handle it without interception.
    }

    // 2. Network First, Fallback to Cache for core assets and navigation.
    // This ensures the user always gets the latest version if they are online.
    const isCoreAsset = CORE_ASSETS.some(asset => url.pathname.endsWith(asset));
    if (request.mode === 'navigate' || isCoreAsset) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    // If fetch is successful, update the cache with the new version.
                    if (response && response.ok) {
                        const responseClone = response.clone();
                        caches.open(CORE_CACHE_NAME).then(cache => {
                            cache.put(request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // If fetch fails (offline), try to serve from the cache.
                    return caches.match(request, {
                        cacheName: CORE_CACHE_NAME
                    });
                })
        );
        return;
    }

    // 3. Cache First, Fallback to Network for defined static assets ONLY.
    // This is fast and efficient for assets that rarely change.
    const isStaticAsset = STATIC_ASSETS.some(assetUrl => request.url === assetUrl || url.pathname === assetUrl);
    if (isStaticAsset) {
        event.respondWith(
            caches.match(request, {
                cacheName: STATIC_CACHE_NAME
            }).then(cachedResponse => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                return fetch(request).then(networkResponse => {
                    if (networkResponse && networkResponse.ok) {
                        const responseClone = networkResponse.clone();
                        caches.open(STATIC_CACHE_NAME).then(cache => {
                            cache.put(request, responseClone);
                        });
                    }
                    return networkResponse;
                });
            })
        );
        return;
    }

    // Any other GET requests are not handled and will be passed through to the network.
});


// Listener for the 'skipWaiting' message from the client.
self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});