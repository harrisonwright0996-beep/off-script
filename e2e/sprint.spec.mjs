import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { importScript, answerCard, keysOf } from './helpers.mjs';

const shot = (page, name) => page.screenshot({ path: `shots/${test.info().project.name}-${name}.png` });

test('a sprint by keypad: teach, first letters, a beat run with them, then one without: who speaks, type, word perfect', async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await expect(page.getByRole('heading', { name: 'New', exact: true })).toBeVisible();
  await expect(page.getByText('Start of Prologue')).toBeVisible();
  await shot(page, 'card-test');
  await page.getByRole('button', { name: 'Teach me' }).click();
  await expect(page.getByText('We are the ones who stayed.', { exact: false })).toBeVisible();
  await shot(page, 'card-front');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('W a t o w s. W a t o w w.')).toBeVisible();
  await expect(page.getByText('Say it aloud from the first letters, then reveal it.')).toBeVisible();
  await shot(page, 'card-help');
  await page.getByRole('button', { name: 'Reveal' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.result.perfect')).toHaveText(/Right with the first letters/);
  await expect(page.getByText('It comes back later with the first letters, then without.')).toBeVisible();
  await shot(page, 'card-help-result');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // The rest of the beat is taught, then run with the first letters once more.
  for (let i = 0; i < 20 && (await page.locator('h1').textContent()) === 'New'; i++) await answerCard(page);
  await expect(page.getByRole('heading', { name: 'Beat run', exact: true })).toBeVisible();
  await expect(page.getByText('Say it aloud from the first letters, then reveal it.')).toBeVisible();
  // Then the next beat is taught, and the first is run from the cue alone.
  const onShow = () => page.evaluate(() => `${document.querySelector('h1').textContent}:${window.offScript.card.step}`);
  for (let i = 0; i < 40 && (await onShow()) !== 'Beat run:floor'; i++) await answerCard(page);
  await expect(page.getByRole('heading', { name: 'Beat run', exact: true })).toBeVisible();
  await expect(page.getByText('Line 1 of 4', { exact: false })).toBeVisible();
  await expect(page.getByText('Who speaks next?')).toBeVisible();
  await shot(page, 'card-floor-speaker');
  await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Cast', exact: true }).click();
  await shot(page, 'card-floor-keypad');
  // Tap the keypad itself for the first word, then a hardware keyboard for the rest.
  await page.getByRole('button', { name: 'w', exact: true }).click();
  await page.keyboard.type((await keysOf(page)).slice(1));
  await expect(page.locator('.result.perfect')).toHaveText(/Word perfect/);
  await shot(page, 'card-result');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // The rest of the run.
  const steps = [];
  for (let i = 0; i < 40; i++) {
    const label = await page.locator('h1').textContent();
    if (label !== 'Beat run') break;
    steps.push(`${label}:${await answerCard(page)}`);
  }
  expect(steps.length).toBeGreaterThanOrEqual(3);
  const progress = await page.evaluate(() => window.offScript.plan().progress.perfectWords);
  expect(progress).toBeGreaterThan(0);
});

test('a miss shows the right word and comes back through first letters; undo puts it back', async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await page.getByRole('button', { name: 'Try it' }).click();
  await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Keeper', exact: true }).click();
  await expect(page.getByText('It was Cast', { exact: false }).or(page.locator('.chip.right'))).toBeVisible();
  const keys = await keysOf(page);
  await page.keyboard.type('?' + keys.slice(1));
  await expect(page.locator('.result.misses')).toHaveText(/It was Cast\. One miss: We/);
  await expect(page.locator('.tok.miss')).toHaveCount(1);
  await shot(page, 'card-result-miss');
  await page.getByRole('button', { name: 'Undo last answer' }).click();
  await expect(page.getByText('Who speaks next?')).toBeVisible();
  const states = await page.evaluate(() => [...window.offScript.states.values()]);
  expect(states.every((st) => st.status === 'new' && st.misses === 0)).toBe(true);
  expect(await page.evaluate(() => window.offScript.events.length)).toBe(0);
  await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Cast', exact: true }).click();
  await page.keyboard.type('z' + keys.slice(1));
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Say it aloud, meaning it.')).toBeVisible(); // a missed try is taught: read it
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText('Say it aloud from the first letters, then reveal it.')).toBeVisible(); // then the first letters
});

test('Say mode: reveal, tap the words missed, done', async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await page.getByRole('button', { name: 'Try it' }).click();
  await page.getByRole('button', { name: 'Say it instead' }).click();
  await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Cast', exact: true }).click();
  await page.getByRole('button', { name: 'Reveal' }).click();
  await shot(page, 'card-say');
  await page.getByRole('group', { name: 'Tap any word you missed or changed' }).getByRole('button', { name: 'stayed.' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.result.misses')).toHaveText(/One miss: stayed/);
  expect(await page.evaluate(() => window.offScript.settings.mode)).toBe('say');
});

test('progress survives a reload, and the sprint carries on where it was', async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Start sprint' }).click();
  for (let i = 0; i < 5; i++) await answerCard(page);
  const before = await page.evaluate(() => ({ card: window.offScript.card.item.id, states: window.offScript.states.size }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.offScript.states.size)).toBe(before.states);
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await page.waitForFunction(() => window.offScript.card);
  expect(await page.evaluate(() => window.offScript.card.item.id)).toBe(before.card);
});

// Offline for real: a server of its own, stopped once the app is installed. (Playwright's WebKit
// cannot emulate offline with a service worker, so this works the same way in both browsers.)
test('works offline once installed, with the server gone', async ({ page }) => {
  const server = spawn(process.execPath, ['tools/serve.mjs', '4199'], { stdio: 'ignore' });
  try {
    await expect.poll(async () => fetch('http://localhost:4199/off-script/').then((r) => r.status).catch(() => 0)).toBe(200);
    await importScript(page, 'http://localhost:4199/off-script/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    server.kill();
    await expect.poll(async () => fetch('http://localhost:4199/off-script/').then(() => 'up').catch(() => 'down')).toBe('down');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Start sprint' }).click();
    await expect(page.getByRole('button', { name: 'Try it' })).toBeVisible();
  } finally {
    server.kill();
  }
});

test('time up: the lines still to finish come first, then Sprint done and a break; Just 2 minutes ends with Keep going?', async ({ page }) => {
  await importScript(page);
  await page.evaluate(() => (window.offScript.settings.sprintMinutes = 0.02)); // a one second sprint
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await page.waitForTimeout(1300);
  await answerCard(page); // Teach me
  await answerCard(page); // Front
  await answerCard(page); // First letters: a new line has them once more, then a go without
  await expect(page.getByRole('heading', { name: 'Again', exact: true })).toBeVisible();
  await expect(page.getByText("Time's up. Just the lines still to finish, then you're done.")).toBeVisible();
  await expect(page.getByText('Say it aloud from the first letters, then reveal it.')).toBeVisible();
  await shot(page, 'card-closing');
  await answerCard(page); // the first letters once more
  await answerCard(page); // From the cue alone: nothing is left to finish, so the sprint ends here
  await expect(page.getByRole('heading', { name: 'Sprint done' })).toBeVisible();
  await expect(page.getByText('1 answer, 1 word perfect.')).toBeVisible();
  await expect(page.getByText('Stand up, drink some water', { exact: false })).toBeVisible();
  await shot(page, 'sprint-done');
  await page.getByRole('button', { name: 'Stop for now' }).click();
  await page.evaluate(() => window.offScript.go('sprint', { minutes: 0.02 }));
  await page.waitForTimeout(1300);
  for (let i = 0; i < 5; i++) await answerCard(page); // teach, read, first letters, them once more, then without
  await expect(page.getByRole('heading', { name: 'Keep going?' })).toBeVisible();
});

test("when today's plan is done: a head start on tomorrow, said plainly", async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Start sprint' }).click();
  for (let i = 0; i < 60; i++) {
    if ((await page.locator('h1').textContent()) === "Today's plan is done") break;
    await answerCard(page);
  }
  await expect(page.getByRole('heading', { name: "Today's plan is done" })).toBeVisible();
  await expect(page.getByText('The next check is ready in about', { exact: false })).toBeVisible();
  await shot(page, 'plan-done');
  await page.getByRole('button', { name: 'Head start on tomorrow' }).click();
  await expect(page.getByText("Today's plan is done. This is a head start on tomorrow.")).toBeVisible();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
});
