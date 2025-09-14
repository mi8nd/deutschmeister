const STATIC_CACHE_NAME = 'DeutschMeister-static-v1';
const DYNAMIC_CACHE_NAME = 'DeutschMeister-dynamic-v1';

const CORE_ASSETS = [
  '/',
  'index.html',
  'style.css',
  'app.js',
  'auth.js',
  'firebase.js',
  'quiz.js',
  'youtube.js',
  'translations.js',
  'icon.png',
  '/assets/google-logo.svg',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,1,0'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      console.log('Service Worker: Pre-caching core assets...');
      return cache.addAll(CORE_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys
        .filter(key => key !== STATIC_CACHE_NAME && key !== DYNAMIC_CACHE_NAME)
        .map(key => caches.delete(key))
      );
    })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(DYNAMIC_CACHE_NAME).then(cache => {
            cache.put(request.url, copy);
          });
          return response;
        })
        .catch(() => caches.match(request.url))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cacheRes => {
      return cacheRes || fetch(request).then(fetchRes => {
        return caches.open(DYNAMIC_CACHE_NAME).then(cache => {
          cache.put(request.url, fetchRes.clone());
          return fetchRes;
        });
      });
    })
  );
});