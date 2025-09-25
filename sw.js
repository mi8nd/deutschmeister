// A robust service worker with strategic caching for optimal performance and offline reliability.

const CACHE_VERSION = 'v3'; // Increment this version number to trigger an update for all users.
const STATIC_CACHE_NAME = `deutschmeister-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE_NAME = `deutschmeister-dynamic-${CACHE_VERSION}`;

// Assets that are critical for the app shell to function.
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

// Domains that should not be intercepted by the service worker.
// Requests to these domains will be handled directly by the browser.
const BYPASS_DOMAINS = [
    'youtube.com',
    'ytimg.com',
    'google.com',
    'googleapis.com',
    'gstatic.com',
    'firebaseapp.com'
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
                // Take control of all open client pages.
                return self.clients.claim();
            });
        })
    );
});

// The main fetch handler with strategic caching.
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // 1. Bypass Strategy: Ignore requests to external domains and non-GET requests.
    const isBypassed = BYPASS_DOMAINS.some(domain => url.hostname.endsWith(domain));
    if (isBypassed || request.method !== 'GET') {
        // Let the browser handle these requests normally.
        return;
    }

    // 2. Strategy for App Shell (JS, CSS, etc., but not the HTML page): Stale-While-Revalidate
    // This serves cached content immediately for speed, then updates the cache in the background.
    const isAppShellAsset = APP_SHELL_ASSETS.some(asset => url.pathname.endsWith(asset) && !url.pathname.endsWith('index.html') && asset !== '/');
    if (isAppShellAsset) {
        event.respondWith(
            caches.match(request).then((cachedResponse) => {
                // Fetch from network in the background to update the cache for the next visit.
                const fetchPromise = fetch(request).then((networkResponse) => {
                    caches.open(STATIC_CACHE_NAME).then((cache) => {
                        cache.put(request, networkResponse.clone());
                    });
                    return networkResponse;
                }).catch(err => console.error('[Service Worker] App Shell fetch failed:', err)); // Catch background fetch errors.

                // Return cached response if available, otherwise wait for the network.
                return cachedResponse || fetchPromise;
            })
        );
        return;
    }

    // 3. Strategy for HTML pages (Navigation): Network First, Fallback to Cache
    // This ensures users get the latest version of the page if they are online.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(networkResponse => {
                    // If fetch is successful, clone it and cache the response for offline use.
                    const responseToCache = networkResponse.clone();
                    caches.open(STATIC_CACHE_NAME).then(cache => {
                        cache.put(request.url, responseToCache);
                    });
                    return networkResponse;
                })
                .catch(() => {
                    // If network fails, return the cached HTML page.
                    return caches.match(request.url)
                        .then(cachedResponse => cachedResponse || caches.match('/index.html'));
                })
        );
        return;
    }

    // 4. Strategy for Other Assets (e.g., PDFs, fonts): Cache First, Fallback to Network
    // This is efficient for static assets that don't change often. They are cached dynamically on first request.
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse; // Return from cache if found.
            }
            // Otherwise, fetch from the network, cache it in the dynamic cache, and then return it.
            return fetch(request).then((networkResponse) => {
                return caches.open(DYNAMIC_CACHE_NAME).then((cache) => {
                    cache.put(request, networkResponse.clone());
                    return networkResponse;
                });
            });
        }).catch(error => {
            console.error('[Service Worker] Dynamic asset fetch failed:', error);
            // Optionally provide a generic fallback for images or other assets here.
        })
    );
});


// Listener for the 'skipWaiting' message from the client (app.js).
self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});