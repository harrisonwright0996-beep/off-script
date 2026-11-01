// Reminders: what the phone tells the worker, and that it tells it nothing until they are on.
import { readFileSync } from 'node:fs';
import { test, expect, importScript, answerCard } from './helpers.mjs';

// A phone that can have reminders, and a worker that keeps a note of what it is told.
function fakePush() {
  window.PushManager ||= function () {};
  window.Notification = Object.assign(function () {}, {
    permission: 'default',
    requestPermission: async () => (Notification.permission = window.pushAnswer || 'granted'),
  });
  const sub = { endpoint: 'https://web.push.apple.com/test-phone', unsubscribe: async () => (window.pushSub = null, true) };
  const reg = { pushManager: { getSubscription: async () => window.pushSub || null, subscribe: async () => (window.pushSub = sub) } };
  Object.defineProperty(navigator.serviceWorker, 'ready', { value: Promise.resolve(reg) });
  navigator.serviceWorker.getRegistration = async () => reg;
  window.workerCalls = [];
  window.workerAnswers = {};
  const real = window.fetch;
  window.fetch = async (url, init) => {
    if (!String(url).includes('off-script-reminders')) return real(url, init);
    const path = new URL(url).pathname;
    window.workerCalls.push({ path, body: JSON.parse(init.body) });
    if (window.workerAnswers[path] === 'hang') return new Promise(() => {});
    return new Response(null, { status: window.workerAnswers[path] || 204 });
  };
}

const calls = (page) => page.evaluate(() => window.workerCalls);
const toSettings = (page) => page.getByRole('button', { name: 'Settings' }).click();
const turnOn = (page) => page.getByRole('button', { name: 'Turn reminders on' }).click();

async function remindersOn(page) {
  await page.addInitScript(fakePush);
  await importScript(page, './');
  await toSettings(page);
  await turnOn(page);
  await expect(page.getByText('Reminders are on.')).toBeVisible();
}

test('Settings says what reminders do, and how to turn them off', async ({ page }, info) => {
  await remindersOn(page);
  await page.getByRole('heading', { name: 'Reminders' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Turn reminders off' })).toBeVisible();
  await expect(page.getByText('null', { exact: true })).toHaveCount(0);
  await expect(page.getByText('If today’s plan is not done, a nudge comes about 3 hours after you last used the app')).toBeVisible();
  await page.screenshot({ path: `shots/${info.project.name}-reminders-on.png` });
});

test('a phone that cannot have reminders says why', async ({ page }) => {
  await page.addInitScript(() => delete window.PushManager);
  await importScript(page, './');
  await toSettings(page);
  await expect(page.getByText('Reminders need Off Script on your Home Screen, on an up to date iPhone.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn reminders on' })).toHaveCount(0);
});

test('with reminders off, the worker hears nothing at all', async ({ page }) => {
  await page.addInitScript(fakePush);
  await importScript(page, './');
  await toSettings(page);
  await expect(page.getByText('Reminders are off.')).toBeVisible();
  await page.evaluate(() => window.offScript.go('today'));
  await page.evaluate(() => (window.offScript.settings.sprintMinutes = 0.02));
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await page.waitForTimeout(300);
  expect(await calls(page)).toEqual([]);
});

test('turning them on sends a push address and a time, and nothing else', async ({ page }) => {
  await remindersOn(page);
  const sent = await calls(page);
  expect(sent.map((c) => c.path)).toEqual(['/push/sub']);
  const { body } = sent[0];
  expect(Object.keys(body).sort()).toEqual(['endpoint', 'id', 'nextAt']);
  expect(body.id).toMatch(/^[a-f0-9]{32}$/);
  expect(body.endpoint).toBe('https://web.push.apple.com/test-phone');
  const now = await page.evaluate(() => Date.now());
  expect(Math.abs(body.nextAt - (now + 3 * 3600000))).toBeLessThan(60000);
  expect(await page.evaluate(() => window.offScript.store.get('reminder'))).toEqual({ title: 'Off Script', body: 'A few minutes now does more than a long go later.' });
});

test('the end of a sprint tells the worker too, before he goes back to Today', async ({ page }) => {
  await remindersOn(page);
  await page.evaluate(async () => {
    await window.offScript.go('today');
    window.offScript.settings.sprintMinutes = 0.02;
  });
  await expect.poll(async () => (await calls(page)).length).toBe(2);
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await page.waitForTimeout(1300);
  await expect(async () => {
    await answerCard(page);
    await expect(page.getByRole('heading', { name: 'Sprint done' })).toBeVisible({ timeout: 300 });
  }).toPass({ timeout: 15000 });
  await expect.poll(async () => (await calls(page)).length).toBe(3);
  expect((await calls(page))[2].path).toBe('/push/next');
});

test('each time Today opens the worker hears the next time, and off makes it forget', async ({ page }) => {
  await remindersOn(page);
  const { id } = (await calls(page))[0].body;
  await page.evaluate(() => window.offScript.go('today'));
  await expect.poll(async () => (await calls(page)).map((c) => c.path)).toEqual(['/push/sub', '/push/next']);
  expect(Object.keys((await calls(page))[1].body).sort()).toEqual(['id', 'nextAt']);
  await toSettings(page);
  await page.getByRole('button', { name: 'Turn reminders off' }).click();
  await expect(page.getByText('Reminders are off.')).toBeVisible();
  const last = (await calls(page)).at(-1);
  expect(last).toEqual({ path: '/push/off', body: { id } });
  expect(await page.evaluate(() => window.pushSub)).toBeNull();
  expect(await page.evaluate(() => window.offScript.store.get('push'))).toBeUndefined();
});

test('a phone the worker has forgotten, after reminders went unopened, goes back on when the app opens', async ({ page }) => {
  await remindersOn(page);
  const { id } = (await calls(page))[0].body;
  await page.evaluate(() => {
    window.workerAnswers['/push/next'] = 404;
    return window.offScript.go('today');
  });
  await expect.poll(async () => (await calls(page)).map((c) => c.path)).toEqual(['/push/sub', '/push/next', '/push/sub']);
  expect((await calls(page))[2].body.id).toBe(id);
});

test('notifications taken away in the phone’s settings count as off', async ({ page }) => {
  await remindersOn(page);
  await page.evaluate(() => {
    Notification.permission = 'denied';
    return window.offScript.go('today');
  });
  await toSettings(page);
  await expect(page.getByText('Reminders are off.')).toBeVisible();
  expect((await calls(page)).map((c) => c.path)).toEqual(['/push/sub']);
});

test('saying no to notifications, or a worker that cannot be reached, says what to do', async ({ page }) => {
  await page.addInitScript(fakePush);
  await importScript(page, './');
  await toSettings(page);
  const trouble = 'Reminders did not switch on. Check notifications are allowed for Off Script in your iPhone settings.';
  await page.evaluate(() => (window.pushAnswer = 'denied'));
  await turnOn(page);
  await expect(page.getByRole('alert').filter({ hasText: trouble })).toBeVisible();
  expect(await calls(page)).toEqual([]);
  await page.evaluate(() => {
    window.pushAnswer = 'granted';
    window.workerAnswers['/push/sub'] = 500;
  });
  await turnOn(page);
  await expect(page.getByText('Reminders are off.')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: trouble })).toBeVisible();
  expect(await page.evaluate(() => window.offScript.store.get('push'))).toBeUndefined();
});

test('Remove everything tells the worker to forget, and no signal does not hold it up', async ({ page }) => {
  await remindersOn(page);
  await page.evaluate(() => (window.workerAnswers['/push/off'] = 'hang'));
  await page.getByRole('button', { name: 'Remove everything' }).click();
  await expect(page.getByRole('heading', { name: 'Remove everything?' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove everything' }).click();
  await expect(page.getByRole('button', { name: 'Continue in Safari for now' }).or(page.getByRole('heading', { name: 'Off Script', exact: true }))).toBeVisible({ timeout: 8000 });
  expect(await page.evaluate(() => window.offScript.model)).toBeNull();
});

// The service worker's own code for the words of a reminder, run as it stands in sw.js.
const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const nudge = sw.slice(sw.indexOf('const DEFAULT_NUDGE'), sw.indexOf("self.addEventListener('push'"));
const savedNudge = `(() => { ${nudge}; return savedNudge(); })()`;

test('a push after Remove everything uses the plain words and does not make a new database', async ({ page }) => {
  await page.goto('styles.css'); // the same address, with no app open
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  expect(await page.evaluate(savedNudge)).toEqual({ title: 'Off Script', body: 'Your lines are ready when you are.' });
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  // A phone that cannot list its databases falls back on aborting the open. Nothing gets a version.
  await page.evaluate(() => {
    IDBFactory.prototype.real = IDBFactory.prototype.databases;
    delete IDBFactory.prototype.databases;
  });
  expect((await page.evaluate(savedNudge)).title).toBe('Off Script');
  const left = await page.evaluate(() => indexedDB.real());
  expect(left.filter((d) => d.version > 0)).toEqual([]);
});

test('a push reads the saved words and lets go of the database', async ({ page }) => {
  await page.goto('styles.css');
  const words = { title: 'Off Script', body: 'Saved on the phone.' };
  await page.evaluate((words) => new Promise((resolve) => {
    const db = indexedDB.open('off-script', 1);
    db.onupgradeneeded = () => db.result.createObjectStore('kv');
    db.onsuccess = () => {
      const tx = db.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(words, 'reminder');
      tx.oncomplete = () => {
        db.result.close();
        resolve();
      };
    };
  }), words);
  expect(await page.evaluate(savedNudge)).toEqual(words);
  const end = await page.evaluate(() => new Promise((resolve) => {
    const del = indexedDB.deleteDatabase('off-script');
    del.onblocked = () => resolve('blocked');
    del.onsuccess = () => resolve('deleted');
  }));
  expect(end).toBe('deleted');
});
