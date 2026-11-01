// Offline: every app file is cached under one version name and served from the cache first.
// A new version takes over as soon as it is here. That does not disturb a sprint or a walk: an open
// page keeps what it has loaded, and starts again by itself at the next Today (app.js, today.js).
// Change VERSION with every release.
const VERSION = 'off-script-2026-11-01-28';
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
  'src/reminders.js',
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

// A reminder is an empty push: the words were saved on the phone the last time the app was used, so
// they never leave it. A push must always show something.
const DEFAULT_NUDGE = { title: 'Off Script', body: 'Your lines are ready when you are.' };

// Whether nothing is saved, as after Remove everything. Safari keeps an empty database even from an
// aborted open, so look first where the phone can.
async function nothingSaved() {
  try {
    return !(await indexedDB.databases()).some((d) => d.name === 'off-script');
  } catch {
    return false;
  }
}

async function savedNudge() {
  if (await nothingSaved()) return DEFAULT_NUDGE;
  const words = await new Promise((resolve) => {
    const open = indexedDB.open('off-script');
    open.onupgradeneeded = () => open.transaction.abort(); // never make one
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result;
      try {
        const get = db.transaction('kv', 'readonly').objectStore('kv').get('reminder');
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
      db.close(); // goes once the read is done, so it never holds up Remove everything
    };
  });
  return words || DEFAULT_NUDGE;
}

self.addEventListener('push', (event) => {
  event.waitUntil(savedNudge().then(({ title, body }) => self.registration.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'off-script-nudge' })));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => (list.length ? list[0].focus() : self.clients.openWindow('./'))),
  );
});
