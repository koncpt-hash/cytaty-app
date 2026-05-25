const CACHE = 'cytaty-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
  '/fonts/SeasonSerif-TRIAL-Medium.woff2',
  '/fonts/SeasonSerif-TRIAL-Bold.woff2',
  '/fonts/SeasonSans-TRIAL-Regular.woff2',
  '/fonts/SeasonSans-TRIAL-Medium.woff2',
  '/icons/mic.svg',
  '/icons/today.svg',
  '/icons/stats.svg',
  '/icons/list.svg',
  '/icons/settings.svg',
  '/icons/plus.svg',
  '/icons/search.svg',
  '/icons/edit.svg',
  '/icons/close.svg',
  '/icons/arrow-back.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Network first for Airtable / Claude API
  if (e.request.url.includes('api.airtable.com') || e.request.url.includes('api.anthropic.com')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// Push notifications
self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.author || 'Cytaty', {
      body: data.quote || 'Masz cytaty do powtórki',
      icon: '/icons/app/icon-192.png',
      badge: '/icons/app/icon-192.png',
      tag: 'daily-review',
      data: { url: '/' },
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || '/'));
});

// Message from app to show local notification
self.addEventListener('message', e => {
  if (e.data?.type === 'SHOW_NOTIFICATION') {
    const { author, quote, source } = e.data;
    self.registration.showNotification(author || 'Cytaty', {
      body: (quote || '').substring(0, 100) + (quote?.length > 100 ? '…' : ''),
      icon: '/icons/app/icon-192.png',
      tag: 'daily-review',
      data: { url: '/' },
    });
  }
});
