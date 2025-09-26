// A robust service worker with strategic caching for optimal performance and offline reliability.

const CACHE_VERSION = 'v4'; // Increment this version number to trigger an update for all users.
const STATIC_CACHE_NAME = `deutschmeister-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE_NAME = `deutschmeister-dynamic-${CACHE_VERSION}`;

// Assets that are critical for the app shell to function.
// These are pre-cached during the 'install' event.
const APP_SHELL_ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/auth.js',
    '/firebase.js',
    '/quiz.js',
    '/youtube.js',
    '/translations.js',
    '/manifest.json',
    '/icon.png'
];

// Domains that should be fetched from the network and not intercepted by the service worker.
const BYPASS_DOMAINS = [
    'youtube.com',
    'ytimg.com',
    'google.com',
    'googleapis.com',
    'gstatic.com',
    'firebaseapp.com',
    'ipapi.co' // Added to ensure geolocation API is not cached
];


// On install, pre-cache all critical app shell assets.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Caching App Shell...');
                return cache.addAll(APP_SHELL_ASSETS);
            })
            .then(() => {
                // Force the waiting service worker to become the active service worker.
                console.log('[Service Worker] Pre-caching complete. Activating immediately.');
                return self.skipWaiting();
            })
    );
});

// On activation, clean up old caches to save space and prevent conflicts.
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    // Delete any caches that are not the current static or dynamic caches.
                    if (cacheName !== STATIC_CACHE_NAME && cacheName !== DYNAMIC_CACHE_NAME) {
                        console.log('[Service Worker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            ).then(() => {
                console.log('[Service Worker] Old caches cleared. Claiming clients.');
                // Take control of all open client pages to ensure the new SW is used.
                return self.clients.claim();
            });
        })
    );
});

// The main fetch handler with robust, strategic caching.
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // 1. Bypass Strategy: Ignore requests to external domains and non-GET requests.
    const isBypassed = BYPASS_DOMAINS.some(domain => url.hostname.endsWith(domain));
    if (isBypassed || request.method !== 'GET') {
        // Let the browser handle these requests normally.
        return;
    }

    // 2. Strategy for HTML pages (Navigation): Network First, Fallback to Cache
    // This ensures users always get the latest version of the app's entry point if online.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(networkResponse => {
                    // If the fetch is successful, clone it, cache it, and return it.
                    const responseToCache = networkResponse.clone();
                    caches.open(STATIC_CACHE_NAME).then(cache => {
                        cache.put(request, responseToCache);
                    });
                    return networkResponse;
                })
                .catch(() => {
                    // If the network fails, serve the cached page or the main index.html as a final fallback.
                    // This serves as the offline page functionality.
                    return caches.match(request)
                        .then(cachedResponse => cachedResponse || caches.match('/index.html'));
                })
        );
        return;
    }

    // 3. Strategy for ALL other assets (CSS, JS, Fonts, PDFs): Cache First, Fallback to Network
    // This is ideal for static assets, providing instant loads and offline availability.
    event.respondWith(
        caches.match(request)
            .then(cachedResponse => {
                // Return from cache if available.
                if (cachedResponse) {
                    return cachedResponse;
                }
                // Otherwise, fetch from the network.
                return fetch(request).then(networkResponse => {
                    // Determine the correct cache to use (static for app shell, dynamic for others).
                    const isShellAsset = APP_SHELL_ASSETS.some(asset => url.pathname.endsWith(asset));
                    const cacheName = isShellAsset ? STATIC_CACHE_NAME : DYNAMIC_CACHE_NAME;

                    return caches.open(cacheName).then(cache => {
                        // Ensure the response is valid before caching.
                        if (networkResponse && networkResponse.status === 200) {
                            // IMPORTANT: Clone the response. A response can only be consumed once.
                            cache.put(request, networkResponse.clone());
                        }
                        return networkResponse;
                    });
                });
            })
            .catch(error => {
                // This catch handles failures if both cache and network fail for non-navigation requests.
                console.error(`[Service Worker] Fetch failed for ${request.url}; could not serve from cache or network.`, error);
                // Return a generic error Response to ensure event.respondWith() doesn't fail.
                return new Response('Network error.', {
                    status: 408, // Request Timeout
                    headers: { 'Content-Type': 'text/plain' },
                });
            })
    );
});


// Listener for the 'skipWaiting' message from the client (app.js).
// This allows the client to trigger an immediate activation of a new service worker.
self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});