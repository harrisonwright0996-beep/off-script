import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { importScript, importPack, answerCard, chooseFile } from './helpers.mjs';

const shot = (page, name) => page.screenshot({ path: `shots/${test.info().project.name}-${name}.png`, fullPage: true });

test('scenes and the reader: numbers, brackets, on screen text; learn a scene next; run it', async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Scenes' }).click();
  await page.getByRole('button', { name: /Scene 3: Landfall/ }).click();
  await expect(page.getByRole('heading', { name: 'Scene 3: Landfall' })).toBeVisible();
  await page.getByRole('button', { name: 'Learn this scene next' }).click();
  await expect(page.getByRole('button', { name: 'Learn this scene next' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.offScript.index.beatById.get(window.offScript.plan().newBeats[0]).scene)).toBe(3);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: /Scene 1: The Harbour/ }).click();
  await expect(page.locator('.reader')).toContainText('[On screen] Phone New message: where are you?');
  await expect(page.locator('.reader')).toContainText('[She reads it.]');
  await expect(page.locator('.reader .n').first()).toHaveText('1');
  await shot(page, 'reader');
  await page.getByRole('button', { name: 'Try a run of this scene' }).click();
  await expect(page.getByRole('heading', { name: 'Run: Scene 1: The Harbour' })).toBeVisible();
  await expect(page.getByText('Line 1 of 13', { exact: false })).toBeVisible();
  await answerCard(page);
  await expect(page.getByText('Line 2 of 13', { exact: false })).toBeVisible();
});

test('settings: look changes at once; back up, restore, remove everything', async ({ page }) => {
  await page.addInitScript(() => {
    // Force the download path for backups: no share sheet in a test browser.
    Object.defineProperty(navigator, 'canShare', { value: undefined });
  });
  await importScript(page);
  await page.getByRole('button', { name: 'Start sprint' }).click();
  for (let i = 0; i < 4; i++) await answerCard(page);
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Colours').selectOption({ label: 'Dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Text size').selectOption({ label: '150%' });
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--scale').trim())).toBe('1.5');
  await shot(page, 'settings-dark-150');
  await page.getByLabel('Text size').selectOption({ label: '100%' });

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up progress' }).click();
  const file = await (await download).path();
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  expect(backup.app).toBe('off-script');
  expect(backup.states.length).toBeGreaterThan(0);
  const states = await page.evaluate(() => window.offScript.states.size);

  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: 'Remove everything' }).click();
  await expect(page.getByRole('heading', { name: 'Remove everything?' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove everything' }).click();
  await importScript(page);
  expect(await page.evaluate(() => window.offScript.states.size)).toBe(0);

  await page.getByRole('button', { name: 'Settings' }).click();
  await chooseFile(page, 'Restore a backup', { name: 'Off Script progress.json', mimeType: 'application/json', buffer: readFileSync(file) });
  await expect(page.getByRole('heading', { name: 'Restore this backup?' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.offScript.states.size)).toBe(states);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

// What is kept on the phone for these lines: their states and answers, and any sprint or practice part way.
const kept = (page, scene = null) =>
  page.evaluate(async (scene) => {
    const o = window.offScript;
    const ours = (id) => scene === null || o.model.scenes[scene].itemIds.includes(id);
    return {
      states: (await o.store.allStates()).filter((st) => ours(st.id)).length,
      answers: (await o.store.allEvents()).filter((e) => ours(e.id)).length,
      saved: [(await o.store.get('sprint')) ?? null, (await o.store.get('practice')) ?? null].filter(Boolean).length,
    };
  }, scene);

test('start again from 0%: every line back to not started; the script, audio pack and settings stay', async ({ page }) => {
  await importScript(page);
  await importPack(page);
  await page.getByRole('button', { name: 'Start sprint' }).click();
  for (let i = 0; i < 4; i++) await answerCard(page);
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Colours').selectOption({ label: 'Dark' });
  await page.getByRole('button', { name: 'Start again from 0%' }).click();
  await expect(page.getByRole('heading', { name: 'Start again from 0%?' })).toBeVisible();
  await expect(page.getByText('The script, the audio pack, your dates and your settings stay.', { exact: false })).toBeVisible();
  await shot(page, 'start-again');
  await page.getByRole('button', { name: 'Keep my progress' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  expect((await kept(page)).states).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Start again from 0%' }).click();
  await page.getByRole('button', { name: 'Start again from 0%' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  expect(await kept(page)).toEqual({ states: 0, answers: 0, saved: 0 });
  expect(await page.evaluate(() => [window.offScript.states.size, window.offScript.events.length])).toEqual([0, 0]);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible(); // the script stays
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); // and the settings
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Audio pack: every line has audio', { exact: false })).toBeVisible(); // and the audio pack
  await expect(page.getByRole('button', { name: 'Start again from 0%' })).toHaveCount(0); // nothing to start again
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await expect(page.getByText('Start of Prologue')).toBeVisible(); // from the first line again
});

test('start this scene again: its lines go back to not started, other scenes keep theirs', async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Start sprint' }).click();
  for (let i = 0; i < 3; i++) await answerCard(page); // the Prologue's first line, taught
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'Choose what to practise' }).click();
  await page.getByLabel('Where').selectOption({ label: 'Scene 1: The Harbour' });
  await page.getByLabel('Which lines').selectOption({ label: 'Every line' });
  await page.getByLabel('How much help').selectOption({ label: 'No help' });
  await page.getByRole('button', { name: 'Start' }).click();
  for (let i = 0; i < 3; i++) await answerCard(page); // three lines of Scene 1
  await page.getByRole('button', { name: 'Stop' }).click();
  const prologue = await kept(page, 0);
  expect(prologue.states).toBe(1);
  expect((await kept(page, 1)).states).toBe(3);

  await page.getByRole('button', { name: 'Scenes' }).click();
  await page.getByRole('button', { name: /Prologue/ }).click();
  await expect(page.getByRole('button', { name: 'Start this scene again' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: /Scene 1: The Harbour/ }).click();
  await page.getByRole('button', { name: 'Start this scene again' }).click();
  await expect(page.getByRole('heading', { name: 'Start this scene again?' })).toBeVisible();
  await expect(page.getByText('Every line of Scene 1: The Harbour goes back to not started', { exact: false })).toBeVisible();
  await shot(page, 'start-scene-again');
  await page.getByRole('button', { name: 'Start this scene again' }).click();
  await expect(page.getByRole('heading', { name: 'Scene 1: The Harbour' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try a run of this scene' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start this scene again' })).toHaveCount(0);
  expect(await kept(page, 1)).toEqual({ states: 0, answers: 0, saved: 0 });
  expect(await kept(page, 0)).toEqual({ ...prologue, saved: 0 }); // the Prologue keeps its progress
});
