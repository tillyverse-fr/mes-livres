// Service worker : fait marcher l'appli sans internet.
const VERSION = 'livres-v1';
const FICHIERS = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.json',
  'html5-qrcode.min.js',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(noms => Promise.all(noms.filter(n => n !== VERSION).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // les recherches de livres passent directement par internet
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(req).then(rep => {
        const copie = rep.clone();
        caches.open(VERSION).then(c => c.put(req, copie));
        return rep;
      }).catch(() => caches.match('index.html'));
    })
  );
});

