// When the app cannot start: the watchdog in src/boot.js, which needs nothing else to load.
import { test, expect } from './helpers.mjs';

const started = (page) => page.getByRole('button', { name: 'Continue in Safari for now' }).or(page.getByRole('heading', { name: 'Off Script', exact: true }));

test.describe('the startup watchdog', () => {
  test.use({ serviceWorkers: 'block' }); // so a file can be held back, in WebKit too

  const stuck = (page) => page.getByRole('heading', { name: 'Off Script did not open.' });

  test('an app file that will not load gets a message and a way to try again', async ({ page }) => {
    await page.route('**/src/app.js', (route) => route.abort());
    await page.goto('./');
    await expect(page.getByText('Opening Off Script…')).toBeVisible();
    await expect(stuck(page)).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('alert')).toHaveText('Check your signal and try again. If it keeps happening, close Off Script and open it again.');
    await page.unroute('**/src/app.js');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(started(page)).toBeVisible();
    await page.waitForTimeout(12500);
    await expect(stuck(page)).toHaveCount(0); // once started, it never shows
  });

  test('an app that is only slow still opens, over the message', async ({ page }) => {
    await page.route('**/src/app.js', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 13000));
      await route.continue();
    });
    await page.goto('./', { waitUntil: 'commit' });
    await expect(stuck(page)).toBeVisible({ timeout: 15000 });
    await expect(started(page)).toBeVisible({ timeout: 15000 });
    await expect(stuck(page)).toHaveCount(0);
  });
});
