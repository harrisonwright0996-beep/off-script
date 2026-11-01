import { test, expect, importScript, answerCard } from './helpers.mjs';

test('Today shows the % and the streaks; Settings turns each off', async ({ page }) => {
  await importScript(page);
  await expect(page.locator('.percent')).toHaveText('0%');
  await expect(page.locator('.medal')).toHaveCount(3);
  await expect(page.getByText('A round is 20 minutes of good practice.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Show the % on Today').uncheck();
  await page.getByLabel('Streaks and badges').uncheck();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.locator('.percent')).toHaveCount(0);
  await expect(page.locator('.medal')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Badges' })).toHaveCount(0);
});

test('the % is the share of words word perfect, and 100% only when every word is', async ({ page }) => {
  await importScript(page);
  const set = (share) =>
    page.evaluate(async (share) => {
      const o = window.offScript;
      const ids = o.model.items.map((it) => it.id);
      const day = o.today();
      ids.slice(0, Math.round(ids.length * share)).forEach((id) => o.states.set(id, { ...o.getState(id), status: 'review', lastResult: 'pass', firstDay: day, learnedDay: day, lastDay: day, lastTime: Date.now(), stability: 240, passes: 3, passDays: [day] }));
      await o.go('today');
    }, share);
  await set(0.5);
  await expect(page.locator('.percent')).not.toHaveText('0%');
  await set(0.96);
  await expect(page.locator('.percent')).not.toHaveText('100%');
  await set(1);
  await expect(page.locator('.percent')).toHaveText('100%');
});

test('good practice counts towards a round, and the end of a sprint says what it won', async ({ page }) => {
  await importScript(page);
  await page.evaluate(() => {
    const o = window.offScript;
    o.streak.days[o.today()] = 1199.9;
    Object.assign(o.settings, { sprintMinutes: 0.02 });
    o.go('today');
  });
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await expect(async () => {
    await answerCard(page);
    await expect(page.getByRole('heading', { name: 'Sprint done' })).toBeVisible({ timeout: 100 });
  }).toPass();
  await expect(page.locator('.reward')).toContainText('First round done today.');
  await expect(page.locator('.reward')).toContainText('New badge: First Round.');
  const saved = await page.evaluate(() => window.offScript.store.get('streak'));
  expect(saved.badges).toContain('first-round');
  await page.getByRole('button', { name: 'Stop for now' }).click();
  await expect(page.getByText('1 more round for bronze today', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Badges' }).click();
  await expect(page.getByRole('heading', { name: 'Badges' })).toBeVisible();
  await expect(page.getByText('1 badge so far.')).toBeVisible();
  await expect(page.locator('.badge')).toHaveCount(12);
  await expect(page.locator('.badge.won')).toHaveCount(1);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
});

test('turned off, nothing is said at the end of a sprint, and the minutes are still kept', async ({ page }) => {
  await importScript(page);
  await page.evaluate(() => {
    const o = window.offScript;
    o.streak.days[o.today()] = 1199.9;
    Object.assign(o.settings, { sprintMinutes: 0.02, showStreaks: false });
    o.go('today');
  });
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await expect(async () => {
    await answerCard(page);
    await expect(page.getByRole('heading', { name: 'Sprint done' })).toBeVisible({ timeout: 100 });
  }).toPass();
  await expect(page.locator('.reward')).toHaveCount(0);
  expect(await page.evaluate(() => window.offScript.streak.days[window.offScript.today()])).toBeGreaterThan(1199.9);
});

test('after the update the streaks start from the practice already in the app, once', async ({ page }) => {
  await importScript(page);
  await page.evaluate(async () => {
    const o = window.offScript;
    const id = o.model.items[0].id;
    const events = ['2026-10-26', '2026-10-27'].flatMap((day) => [0, 1, 2, 3].map((i) => ({ id, day, time: new Date(`${day}T10:0${i}:00`).getTime(), mode: 'walk', active: 1300, pass: true })));
    await o.store.putEvents(events);
    await o.store.del('streak');
  });
  await page.reload();
  await expect(page.locator('.medal').first()).toContainText('2 days');
  expect(await page.evaluate(() => window.offScript.store.get('streak').then((s) => s.walks))).toBe(2);
  await page.evaluate(() => window.offScript.store.set('streak', { ...window.offScript.streak, walks: 7 }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  expect(await page.evaluate(() => window.offScript.streak.walks)).toBe(7); // kept from now on
});

