import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { importScript, answerCard, chooseFile } from './helpers.mjs';

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
