// Offline: every app file is cached under one version name and served from the cache first.
// A new version takes over as soon as it is here. That does not disturb a sprint or a walk: an open
// page keeps what it has loaded, and starts again by itself at the next Today (app.js, today.js).
// Change VERSION with every release.
const VERSION = 'off-script-2026-11-01-25';
// Versions up to this one have Update now on Today, and start again from that tap, so a new version
// waits for it: nothing else is sure not to cut off a walk.
const LAST_MANUAL = 17;
const isManual = (key) => Number(/^off-script-\d{4}-\d{2}-\d{2}-(\d+)$/.exec(key)?.[1] ?? Infinity) <= LAST_MANUAL;
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
  'src/boot.js',
  'src/coach.js',
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
  'src/science.js',
  'src/session.js',
  'src/settings.js',
  'src/state.js',
  'src/store.js',
  'src/streak.js',
  'src/tape.js',
  'src/tokens.js',
  'src/tts.js',
  'src/ui/again.js',
  'src/ui/badges.js',
  'src/ui/checkin.js',
  'src/ui/choose.js',
  'src/ui/dom.js',
  'src/ui/hearcue.js',
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
  event.waitUntil(
    (async () => {
      await (await caches.open(VERSION)).addAll(FILES);
      if (!(await caches.keys()).some(isManual)) await self.skipWaiting();
    })(),
  );
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
