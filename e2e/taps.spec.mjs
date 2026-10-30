// Quick double taps. On the phone the second tap of a double tap lands on whatever the first one
// brought up; it must never answer, skip or throw away anything.
import { test, expect, importScript, importPack, answerCard, keysOf } from './helpers.mjs';
import { neighbours } from '../src/grade.js';

// Two touches at the middle of `locator`, `gap` ms apart, after a pause so that the first touch
// does not itself come just as the screen was drawn.
async function doubleTap(page, locator, gap = 120) {
  await page.waitForTimeout(400);
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(gap);
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(500);
}

const step = (page) => page.evaluate(() => window.offScript.card.step);
// The card on show, once it is drawn.
async function card(page) {
  await page.waitForFunction(() => window.offScript && window.offScript.card && document.querySelector('h1').textContent === window.offScript.card.label);
  return page.evaluate(() => {
    const c = window.offScript.card;
    return { key: c.key, step: c.step, speaker: c.item.speaker, ask: !!c.askSpeaker };
  });
}
// Cards are drawn once the step before is saved: waits for the card on show to change from `key`.
const moved = (page, key) => page.waitForFunction((k) => window.offScript.card && window.offScript.card.key !== k, key);

test('Next after reading a line, tapped twice: the next rung is on show, not answered', async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await page.getByRole('button', { name: 'Teach me' }).click();
  await expect(page.getByText('We are the ones who stayed.', { exact: false })).toBeVisible();
  await doubleTap(page, page.getByRole('button', { name: 'Next', exact: true }));
  await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
  expect(await step(page)).toBe('gaps');
});

test('Reveal tapped twice: Done still waits for its own tap', async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Start sprint' }).click();
  for (let i = 0; i < 20 && (await page.locator('h1').textContent()) === 'New'; i++) await answerCard(page);
  await expect(page.getByRole('heading', { name: 'Learning', exact: true })).toBeVisible();
  await doubleTap(page, page.getByRole('button', { name: 'Reveal' }));
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
  await expect(page.locator('.result')).toHaveCount(0);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.result.perfect')).toHaveText(/Right with the first letters/);
});

test('the slip button tapped twice: only that answer is counted right, the miss before it stays a miss', async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Start sprint' }).click();
  // On to the next line tried from the cue alone (reading any line shown on the way), then typed.
  const answer = async (typed) => {
    for (let c = await card(page); c.step !== 'floor'; c = await card(page)) {
      if (c.step === 'help' || c.step === 'gaps') {
        await page.getByRole('button', { name: 'Reveal' }).click();
        await page.getByRole('button', { name: 'Done' }).click();
        await page.getByRole('button', { name: 'Next', exact: true }).click();
      } else await page.getByRole('button', { name: c.step === 'test' ? 'Try it' : 'Next', exact: true }).click();
      await moved(page, c.key);
    }
    const c = await card(page);
    if (c.ask) await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: c.speaker, exact: true }).click();
    const keys = await keysOf(page);
    await page.keyboard.type(typed(keys));
  };
  await answer((keys) => 'p' + keys.slice(1)); // p is nowhere near w: a real miss
  await expect(page.locator('.result.misses')).toBeVisible();
  await expect(page.getByRole('button', { name: /slip of the finger/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await answer((keys) => [...'qwertyuiopasdfghjklzxcvbnm'].find((k) => k !== keys[0] && neighbours(k, keys[0])) + keys.slice(1));
  const slip = page.getByRole('button', { name: 'A slip of the finger? Count it right' });
  await expect(slip).toBeVisible();
  await doubleTap(page, slip, 30);
  await expect(page.locator('.result.perfect')).toHaveText(/Counted right: a slip of the finger/);
  const events = await page.evaluate(() => window.offScript.events.filter((e) => !e.help).map((e) => ({ pass: e.pass, slip: !!e.slip, active: typeof e.active })));
  expect(events).toEqual([
    { pass: false, slip: false, active: 'number' },
    { pass: true, slip: true, active: 'number' },
  ]);
});

test('End walk tapped twice: the walk is still there to save, and saving twice saves it once', async ({ page }) => {
  await importScript(page);
  await importPack(page);
  await page.getByRole('button', { name: 'Walk' }).click();
  await page.getByRole('button', { name: '15 minutes' }).click();
  await page.waitForFunction(() => window.offScript.walk && window.offScript.walk.player.audio.readyState >= 3, null, { timeout: 15000 });
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  const t = await page.evaluate(() => {
    const { tape, player } = window.offScript.walk;
    const at = tape.trials[3].answerEnd + 0.5;
    player.seek(at);
    return at;
  });
  await page.waitForFunction((at) => Math.abs(window.offScript.walk.player.time - at) < 0.5, t);
  await doubleTap(page, page.getByRole('button', { name: 'End walk' }));
  await expect(page.getByRole('heading', { name: 'How did it go?' })).toBeVisible();
  await doubleTap(page, page.getByRole('button', { name: 'All good apart from the ticked ones' }), 30);
  await expect(page.getByRole('heading', { name: 'Walk saved' })).toBeVisible();
  expect(await page.evaluate(() => window.offScript.events.filter((e) => e.mode === 'walk').length)).toBe(4);
});
