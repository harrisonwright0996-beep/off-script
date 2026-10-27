// Offline: every app file is cached under one version name and served from the cache first.
// A new version waits until Off Script asks for it (Update now on Today), so nothing reloads in the
// middle of a sprint. Change VERSION with every release.
const VERSION = 'off-script-2026-10-27-8';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'src/app.js',
  'src/audiopack.js',
  'src/backup.js',
  'src/dates.js',
  'src/docx.js',
  'src/grade.js',
  'src/items.js',
  'src/memory.js',
  'src/mp3.js',
  'src/parse.js',
  'src/plan.js',
  'src/practice.js',
  'src/player.js',
  'src/session.js',
  'src/settings.js',
  'src/state.js',
  'src/store.js',
  'src/tape.js',
  'src/tokens.js',
  'src/tts.js',
  'src/ui/again.js',
  'src/ui/choose.js',
  'src/ui/dom.js',
  'src/ui/install.js',
  'src/ui/keypad.js',
  'src/ui/scenes.js',
  'src/ui/settings.js',
  'src/ui/setup.js',
  'src/ui/sprint.js',
  'src/ui/today.js',
  'src/ui/walk.js',
  'vendor/fflate.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
