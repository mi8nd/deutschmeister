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

// List of origins to allow for dynamic caching
const ALLOWED_ORIGINS = [
	'https://fonts.googleapis.com',
	'https://fonts.gstatic.com',
	'https://www.gstatic.com',
	'https://www.youtube.com'
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
	return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
	const {
		request
	} = event;
	const url = new URL(request.url);

	// Only handle GET requests
	if (request.method !== 'GET') {
		return;
	}

	// Strategy for navigation requests (e.g., loading the main HTML page)
	if (request.mode === 'navigate') {
		event.respondWith(
			fetch(request).catch(() => caches.match('/index.html'))
		);
		return;
	}

	// Strategy for local assets and allowed cross-origin assets
	if (url.origin === self.location.origin || ALLOWED_ORIGINS.includes(url.origin)) {
		event.respondWith(
			caches.match(request).then(cacheRes => {
				return cacheRes || fetch(request).then(fetchRes => {
					return caches.open(DYNAMIC_CACHE_NAME).then(cache => {
						// Check if the response is valid before caching
						if (fetchRes.ok) {
							cache.put(request.url, fetchRes.clone());
						}
						return fetchRes;
					});
				});
			})
		);
	}
});