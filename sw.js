/* â•â• SERVICE WORKER â€” SevaRoute â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   BUMP THIS VERSION STRING on every deploy that changes HTML/JS/CSS.
   Without a bump, browsers keep serving the old cached files.
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const CACHE = 'sevaroute-v8';

const SHELL = [
  './index.html',
  './css/style.css',
  './js/firebase-config.js',
  './js/config.js',
  './js/db.js',
  './js/geo.js',
  './js/rotation.js',
  './js/solver.js',
  './js/excel.js',
  './js/ui-core.js',
  './js/ui-rotation.js',
  './js/ui-checklist.js',
  './js/ui-devotees.js',
  './js/ui-config.js',
  './js/ui-reports.js',
  './js/xlsx-js-style.bundle.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=Nunito:wght@300;400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // One unreachable CDN file must not abort the whole install, or the
      // app silently loses offline support.
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  if (e.request.method !== 'GET') return;

  // Firebase / Firestore always go straight to the network. Firestore runs
  // its own offline persistence layer; caching its traffic here would fight
  // with it and serve stale delivery data.
  if (url.includes('firestore.googleapis.com') ||
      url.includes('firebase') ||
      url.includes('identitytoolkit') ||
      url.includes('googleapis.com/identitytoolkit')) {
    return;
  }

  // Map tiles: cache-first and never revalidated â€” tiles are immutable, and
  // a sevadar in a dead zone still gets the map they loaded this morning.
  if (url.includes('tile.openstreetmap.org')) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        if (res.ok) { const c = res.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); }
        return res;
      }).catch(() => new Response('', { status: 504 })))
    );
    return;
  }

  // App code: network-first so a deploy lands without a hard refresh,
  // falling back to cache when offline.
  if (url.includes('/js/') || url.includes('/css/')) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) { const c = res.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // HTML navigation: network-first, cached shell as the offline fallback.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) { const c = res.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); }
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Everything else (fonts, icons, CDN libs): cache-first.
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) { const c = res.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});


