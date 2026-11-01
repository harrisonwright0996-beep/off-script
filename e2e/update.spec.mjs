// A new version arriving on a phone that is in use, on a server of its own whose sw.js can change.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, importScript, answerCard } from './helpers.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

async function site(port, version) {
  const live = { version };
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    try {
      let body = await readFile(join(root, path === '/' ? 'index.html' : path));
      if (path === '/sw.js') body = body.toString().replace(/const VERSION = '[^']*'/, `const VERSION = '${live.version}'`);
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'text/html', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((done) => server.listen(port, done));
  live.close = () => new Promise((done) => server.close(done));
  return live;
}

const newRelease = (page, live, version = 'test-next') => {
  live.version = version;
  return page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
};
const ready = (page, live) => expect(async () => expect(await page.evaluate(() => caches.keys())).toEqual([live.version])).toPass();
const steady = async (page) => {
  await expect(async () => expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)).toPass();
  await page.evaluate(() => (window.samePage = true));
};
const restarted = (page) => expect(async () => expect(await page.evaluate(() => !window.samePage)).toBe(true)).toPass();

test.describe('updates', () => {
  let live;
  test.beforeEach(async ({ page }, info) => {
    const port = 4400 + info.parallelIndex * 2 + (info.project.name === 'webkit' ? 0 : 1);
    live = await site(port, 'test-first');
    await importScript(page, `http://localhost:${port}/`);
    await steady(page);
  });
  test.afterEach(() => live.close());

  test('on Today a new version starts by itself, and nothing is lost', async ({ page }) => {
    const before = await page.evaluate(() => window.offScript.model.items.length);
    await newRelease(page, live);
    await restarted(page);
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await ready(page, live);
    expect(await page.evaluate(() => window.offScript.model.items.length)).toBe(before);
    await expect(page.getByText('A new version')).toHaveCount(0);
  });

  test('a sprint goes on undisturbed, and the new version starts back at Today', async ({ page }) => {
    await page.getByRole('button', { name: 'Start sprint' }).click();
    await answerCard(page);
    await newRelease(page, live);
    await ready(page, live);
    await answerCard(page);
    await answerCard(page);
    expect(await page.evaluate(() => window.samePage)).toBe(true);
    await page.getByRole('button', { name: 'Stop' }).click();
    await restarted(page);
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  });

  test('it starts by itself on Scenes too, and on leaving a sprint for Scenes', async ({ page }) => {
    await page.getByRole('button', { name: 'Scenes' }).click();
    await expect(page.getByRole('heading', { name: 'Scenes' })).toBeVisible();
    await newRelease(page, live);
    await restarted(page);
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await steady(page);
    await page.getByRole('button', { name: 'Start sprint' }).click();
    await newRelease(page, live, 'test-after');
    await ready(page, live);
    expect(await page.evaluate(() => window.samePage)).toBe(true);
    await page.evaluate(() => window.offScript.go('scenes'));
    await restarted(page);
  });
});
