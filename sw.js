// A robust service worker with a cache-first strategy.
// It ensures the app stays up-to-date by using versioned caches.

const CACHE_NAME = 'deutschmeister-v2';

// Assets that are critical for the app shell to function.
const ASSETS_TO_CACHE = [
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

// Domains to completely bypass in the service worker.
// The SW will not intercept requests to these domains.
const BYPASS_DOMAINS = [
    'youtube.com',
    'ytimg.com',
    'google.com',
    'googleapis.com',
    'gstatic.com',
    'firebaseapp.com'
];


// On install, pre-cache all critical assets.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Service Worker: Caching app shell');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => {
                console.log('Service Worker: Pre-caching complete. Activating immediately.');
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
                    if (cacheName !== CACHE_NAME) {
                        console.log('Service Worker: Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            ).then(() => {
                console.log('Service Worker: Old caches cleared. Claiming clients.');
                return self.clients.claim();
            });
        })
    );
});


// The main fetch handler with a cache-first strategy.
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // 1. Bypass requests to external domains and non-GET requests.
    const isBypassed = BYPASS_DOMAINS.some(domain => url.hostname.endsWith(domain));
    if (isBypassed || request.method !== 'GET') {
        return; // Let the browser handle it without interception.
    }

    // 2. Cache First, Fallback to Network for all other requests.
    // This is fast and ideal for an app shell.
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            // If we have a cached response, return it.
            if (cachedResponse) {
                return cachedResponse;
            }

            // Otherwise, fetch from the network.
            return fetch(request).then((networkResponse) => {
                // If the request is successful, clone it and store it in the cache for next time.
                if (networkResponse && networkResponse.ok) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(error => {
                console.error('Service Worker: Fetch failed; serving offline fallback if available.', error);
                // For a navigation request, you could return a fallback offline page.
                if (request.mode === 'navigate') {
                    return caches.match('/');
                }
            });
        })
    );
});


// Listener for the 'skipWaiting' message from the client.
self.addEventListener('message', (event) => {
    if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
});