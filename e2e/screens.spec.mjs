import { readFileSync } from 'node:fs';
import { test, expect, importScript, importPack, answerCard, chooseFile } from './helpers.mjs';

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
  for (let i = 0; i < 10; i++) await answerCard(page); // the first beat read, then into its run
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
  await expect(page.getByRole('button', { name: 'Continue in Safari for now' }).or(page.getByRole('heading', { name: 'Off Script', exact: true }))).toBeVisible();
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
  for (let i = 0; i < 10; i++) await answerCard(page); // the first beat read, then into its run
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
  await page.getByRole('button', { name: 'Try it' }).click();
  await page.waitForFunction(() => window.offScript.card.step === 'floor');
  await answerCard(page); // the Prologue's first line, right at the first try
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

const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// A sprint, on the first card with the keypad.
async function toKeypad(page) {
  await importScript(page);
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await page.getByRole('button', { name: 'Try it' }).click();
  await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Cast', exact: true }).click();
  await expect(page.getByRole('group', { name: /Keypad/ })).toBeVisible();
}

for (const width of [393, 320]) {
  test(`the keypad at ${width} wide: every key whole, and no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await toKeypad(page);
    const keys = await page.locator('.key').evaluateAll((all) => all.map((k) => ({ key: k.dataset.key, ...k.getBoundingClientRect().toJSON() })));
    expect(keys.length).toBeGreaterThan(30);
    for (const k of keys) {
      expect(k.left, k.key).toBeGreaterThanOrEqual(0);
      expect(k.right, k.key).toBeLessThanOrEqual(width);
    }
    expect(await sideways(page)).toBe(0);
  });
}

test('a phone on its side: the keypad leaves room for the line, and the title goes with the page', async ({ page }) => {
  await page.setViewportSize({ width: 568, height: 320 });
  await toKeypad(page);
  const pad = page.getByRole('group', { name: /Keypad/ });
  expect((await pad.boundingBox()).height).toBeLessThan(200);
  expect(await sideways(page)).toBe(0);
  await expect(page.locator('.bar')).toHaveCSS('position', 'static');
});

test('big text on a small phone: the footer goes with the page, nothing pans, the keypad stays the same size', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await importScript(page);
  for (const textSize of [175, 200]) {
    await page.evaluate((textSize) => window.offScript.saveSettings({ textSize }).then(() => window.offScript.go('today')), textSize);
    await expect.poll(() => page.locator('footer').evaluate((el) => getComputedStyle(el).position === 'static' || el.offsetHeight <= 0.4 * innerHeight)).toBe(true);
    expect(await sideways(page)).toBe(0);
    expect(await page.locator('footer .btn').evaluateAll((all) => all.filter((b) => b.scrollWidth > b.clientWidth).map((b) => b.textContent))).toEqual([]);
    for (const [name, params] of [['reader', { scene: 1 }], ['choose', {}], ['scenes', {}], ['settings', {}]]) {
      await page.evaluate(([name, params]) => window.offScript.go(name, params), [name, params]);
      await expect(page.locator('h1')).toBeVisible();
      expect(await sideways(page), name).toBe(0);
    }
  }
  await page.evaluate(() => window.offScript.saveSettings({ textSize: 100 }).then(() => window.offScript.go('today')));
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await page.getByRole('button', { name: 'Try it' }).click();
  await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Cast', exact: true }).click();
  const pad = page.getByRole('group', { name: /Keypad/ });
  await expect(pad).toBeVisible();
  const normal = (await pad.boundingBox()).height;
  await page.evaluate(() => window.offScript.saveSettings({ textSize: 200 }));
  await expect(page.locator('footer')).toHaveCSS('position', 'sticky');
  expect(Math.abs((await pad.boundingBox()).height - normal)).toBeLessThan(8);
});

test('every card can say its cue aloud, and hearing it does not change the card', async ({ page }) => {
  await importScript(page);
  await importPack(page);
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await page.waitForFunction(() => window.offScript.card);
  const id = await page.evaluate(() => {
    window.played = [];
    HTMLMediaElement.prototype.play = function play() {
      window.played.push(this.src);
      return Promise.resolve();
    };
    return window.offScript.card.item.id;
  });
  await expect(async () => {
    await page.getByRole('button', { name: 'Hear the cue' }).click();
    expect(await page.evaluate(() => window.played.at(-1))).toMatch(/^blob:/); // the pack's own voice
  }).toPass();
  expect(await page.evaluate(() => window.offScript.card.item.id)).toBe(id);
});

test('with no audio pack the phone says the cue', async ({ page }) => {
  await page.addInitScript(() => {
    window.said = [];
    window.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text;
      }
    };
    const speak = (u) => {
      window.said.push(u.text);
      setTimeout(() => u.onend && u.onend(), 0);
    };
    Object.defineProperty(window, 'speechSynthesis', { value: { speak, cancel() {}, pause() {}, resume() {}, getVoices: () => [], addEventListener() {} } });
  });
  await importScript(page);
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await page.waitForFunction(() => window.offScript.card);
  const cue = await page.evaluate(() => window.offScript.card.cue.text);
  await page.getByRole('button', { name: 'Hear the cue' }).click();
  await expect.poll(() => page.evaluate(() => window.said.at(-1))).toBe(cue);
});

test('the typing hint sits above the line, where the keypad cannot cover it, and on a long line the newest word stays in view', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 500 });
  await importScript(page);
  await page.evaluate(() => {
    const o = window.offScript;
    const it = o.model.items[0];
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`);
    it.tokens = words.flatMap((w, i) => [...(i ? [{ d: ' ', k: null }] : []), { d: w, k: 'a' }]);
    it.words = 80;
  });
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await page.getByRole('button', { name: 'Try it' }).click();
  await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Cast', exact: true }).click();
  const hint = page.getByText('Say or mouth each word', { exact: false });
  await expect(hint).toBeVisible();
  const order = await page.evaluate(() => {
    const line = document.querySelector('.line.answer');
    const help = document.querySelector('.type-hint');
    return help.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(order).toBeTruthy();
  await page.keyboard.type('a'.repeat(60));
  const gap = await page.evaluate(() => {
    const line = document.querySelector('.line.answer');
    return document.querySelector('footer').getBoundingClientRect().top - line.lastElementChild.getBoundingClientRect().bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(0);
});

test('one main button: Today has Start sprint, Walk and More, and More has the rest', async ({ page }) => {
  await importScript(page, undefined, { oneButton: true });
  await expect(page.locator('footer .btn')).toHaveText(['Start sprint', 'Walk', 'More']);
  await shot(page, 'today-one-button');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'More' })).toBeVisible();
  await shot(page, 'more');
  for (const name of ['Just 2 minutes', 'Run through', 'Choose what to practise', 'Scenes', 'Already know some?', 'Badges', 'Settings']) await expect(page.getByRole('button', { name })).toBeVisible();
  await page.getByRole('button', { name: /^Settings/ }).click();
  await page.getByLabel('One main button, with the rest under More').uncheck();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose what to practise' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
});

test('already know some: a line right is not taught, a line wrong is, and two misses in a row skip the scene', async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Scenes' }).click();
  await page.getByRole('button', { name: 'Already know some? Check them' }).click();
  await expect(page.getByRole('heading', { name: 'Already know some?' })).toBeVisible();
  await page.getByRole('button', { name: 'Yes, check what I know' }).click();
  await expect(page.locator('.where')).toHaveText('Checking your lines: 1 of 23');
  const items = await page.evaluate(() => window.offScript.model.items.map((it) => ({ id: it.id, scene: it.scene, keys: it.tokens.filter((t) => t.k !== null).map((t) => t.k).join('') })));
  await page.keyboard.type(items[0].keys);
  await expect(page.locator('.result.perfect')).toHaveText(/Word perfect/);
  await expect(page.locator('.where')).toHaveText('Checking your lines: 2 of 23');
  const known = await page.evaluate((id) => window.offScript.getState(id), items[0].id);
  expect(known.status).toBe('review');
  expect(known.stability).toBe(4);

  const wrong = (keys) => (keys[0] === 'z' ? 'x' : 'z') + (keys[1] === 'z' ? 'x' : 'z') + keys.slice(2);
  await page.keyboard.type(wrong(items[1].keys));
  await expect(page.locator('.result.misses')).toHaveText(/You will learn it/);
  await page.keyboard.type(wrong(items[2].keys));
  if (items[3].scene === items[2].scene) await expect(page.locator('.result.misses')).toHaveText(/skip the rest of this scene/);
  expect(await page.evaluate((id) => window.offScript.getState(id).status, items[1].id)).toBe('new');

  await page.getByRole('button', { name: 'That is enough, teach me' }).click();
  await expect(page.getByRole('heading', { name: 'All checked' })).toBeVisible();
  await expect(page.getByText('You already know 1 line.')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();

  // Each line has one try: the check goes on from those not tried.
  await page.getByRole('button', { name: 'Scenes' }).click();
  await page.getByRole('button', { name: 'Already know some? Check them' }).click();
  await page.getByRole('button', { name: 'Yes, check what I know' }).click();
  await expect(page.locator('.where')).toHaveText('Checking your lines: 1 of 20');
});

test('already know some: with every line tried it says so, the offer goes from Scenes, and Start again brings it back', async ({ page }) => {
  await importScript(page);
  await page.evaluate(async () => {
    const o = window.offScript;
    await o.store.set('checkTried', o.model.items.map((it) => it.id));
    await o.go('checkin');
  });
  await expect(page.getByText('You have checked all you can.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Yes, check what I know' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await page.getByRole('button', { name: 'Scenes' }).click();
  await expect(page.getByRole('button', { name: 'Already know some? Check them' })).toHaveCount(0);
  await page.evaluate(async () => {
    await window.offScript.store.clearProgress();
  });
  expect(await page.evaluate(() => window.offScript.store.get('checkTried'))).toBeUndefined();
});

