import { test, expect } from '@playwright/test';
import { importScript, importPack } from './helpers.mjs';

const shot = (page, name) => page.screenshot({ path: `shots/${test.info().project.name}-${name}.png` });

test('audio pack: import, build a walk tape that can play, mark a line, review and save', async ({ page }) => {
  await importScript(page);
  await importPack(page);
  await page.getByRole('button', { name: 'Walk' }).click();
  await expect(page.getByText('keep one earbud out', { exact: false })).toBeVisible();
  await shot(page, 'walk-choose');
  await page.getByRole('button', { name: '15 minutes' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.waitForFunction(() => window.offScript.walk && window.offScript.walk.player.audio.readyState >= 3, null, { timeout: 15000 });
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await shot(page, 'walk-playing');
  // Jump to just after the fourth answer, as if the walk had got that far, and mark it.
  const t = await page.evaluate(() => {
    const { tape, player } = window.offScript.walk;
    const at = tape.trials[3].answerEnd + 0.5;
    player.seek(at);
    return at;
  });
  await page.waitForFunction((at) => Math.abs(window.offScript.walk.player.time - at) < 0.5, t);
  await page.getByRole('button', { name: 'Missed that one' }).click();
  await expect(page.getByText('1 line marked as missed.')).toBeVisible();
  await page.getByRole('button', { name: 'End walk' }).click();
  await expect(page.getByRole('heading', { name: 'How did it go?' })).toBeVisible();
  await expect(page.locator('.review-list input:checked')).toHaveCount(1);
  await shot(page, 'walk-review');
  await page.getByRole('button', { name: 'All good apart from the ticked ones' }).click();
  await expect(page.getByRole('heading', { name: 'Walk saved' })).toBeVisible();
  const saved = await page.evaluate(() => window.offScript.events.filter((e) => e.mode === 'walk').map((e) => e.pass));
  expect(saved.length).toBe(4);
  expect(saved.filter((p) => !p).length).toBe(1);
});

test('without an audio pack, Walk reads aloud with the screen on', async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Walk' }).click();
  await expect(page.getByText('There is no audio pack yet', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '15 minutes' }).click();
  await expect(page.getByRole('button', { name: 'Missed', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Got it' })).toBeVisible();
  await page.getByRole('button', { name: 'End walk' }).click();
  await expect(page.getByRole('heading', { name: 'Walk ended' })).toBeVisible();
});
