import { spawn } from 'node:child_process';
import { test, expect, importScript, answerCard, keysOf, seedOnce } from './helpers.mjs';
import { fixtureModel } from '../tests/helpers.mjs';
import { blankOf, firstLettersOf, joinTokens, phraseStarts } from '../src/tokens.js';

const shot = (page, name) => page.screenshot({ path: `shots/${test.info().project.name}-${name}.png` });

test('a sprint by keypad: the beat read line by line, then each line on its own and out of order, with the first letters, then without: who speaks, type, word perfect', async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await expect(page.getByRole('heading', { name: 'New', exact: true })).toBeVisible();
  await expect(page.getByText('Start of Prologue')).toBeVisible();
  await shot(page, 'card-test');
  await page.getByRole('button', { name: 'Teach me' }).click();
  await expect(page.getByText('We are the ones who stayed.', { exact: false })).toBeVisible();
  await shot(page, 'card-front');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  // Straight on to the next line: the whole beat is read first, then its lines come back one at a time.
  await expect(page.getByRole('button', { name: 'Teach me' })).toBeVisible();
  for (let i = 0; i < 20 && (await page.locator('h1').textContent()) === 'New'; i++) await answerCard(page);
  await expect(page.getByRole('heading', { name: 'Learning', exact: true })).toBeVisible();
  await expect(page.getByText('Each new line comes back on its own and out of order, until it is right from its cue twice.')).toBeVisible();
  const { model } = fixtureModel();
  const shown = async () => {
    const id = await page.evaluate(() => window.offScript.card.item.id);
    return model.items.find((x) => x.id === id);
  };
  const first = await shown();
  expect(model.beats[0].itemIds).toContain(first.id);
  await expect(page.getByText(joinTokens(first.tokens, (t) => firstLettersOf(t)))).toBeVisible();
  await expect(page.getByText('Say it aloud from the first letters, then reveal it.')).toBeVisible();
  await shot(page, 'card-help');
  await page.getByRole('button', { name: 'Reveal' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.result.perfect')).toHaveText(/Right with the first letters/);
  await expect(page.getByText('It comes back later without the first letters.')).toBeVisible();
  await shot(page, 'card-help-result');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  // Then, a few cards later, a line from its cue alone.
  const onShow = () => page.evaluate(() => `${document.querySelector('h1').textContent}:${window.offScript.card.step}`);
  for (let i = 0; i < 40 && (await onShow()) !== 'Learning:floor'; i++) await answerCard(page);
  await expect(page.getByRole('heading', { name: 'Learning', exact: true })).toBeVisible();
  await expect(page.getByText('Who speaks next?')).toBeVisible();
  await shot(page, 'card-floor-speaker');
  const line = await shown();
  await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: line.speaker, exact: true }).click();
  await shot(page, 'card-floor-keypad');
  // Tap the keypad itself for the first word, then a hardware keyboard for the rest.
  const keys = await keysOf(page);
  await page.getByRole('button', { name: keys[0], exact: true }).click();
  await page.keyboard.type(keys.slice(1));
  await expect(page.locator('.result.perfect')).toHaveText(/Word perfect/);
  await shot(page, 'card-result');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // Once every line of the beat has had a go, the next beat is read, with this one still being learned.
  for (let i = 0; i < 40 && (await page.locator('h1').textContent()) === 'Learning'; i++) await answerCard(page);
  await expect(page.getByRole('heading', { name: 'New', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.offScript.model.beats[0].itemIds.every((id) => window.offScript.getState(id).helped >= 1))).toBe(true);
  const perfect = () => page.evaluate(() => window.offScript.plan().progress.perfectWords);
  for (let i = 0; i < 60 && (await perfect()) === 0; i++) await answerCard(page);
  expect(await perfect()).toBeGreaterThan(0);
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
  await expect(page.getByRole('button', { name: /slip of the finger/ })).toHaveCount(0); // ? is never a slip
  // Saved with it: which word was missed and how long the line took, for trouble words.
  const last = await page.evaluate(() => window.offScript.events.at(-1));
  expect(last.missed).toEqual([0]);
  expect(last.ms).toBeGreaterThanOrEqual(last.firstMs);
  expect(last.firstMs).toBeGreaterThanOrEqual(0);
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
  await expect(page.getByRole('button', { name: 'Try it' })).toBeVisible(); // then on through the beat
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
  await answerCard(page); // Read: time is up, so nothing new, and it comes back at once with the first letters
  await expect(page.getByRole('heading', { name: 'Learning', exact: true })).toBeVisible();
  await expect(page.getByText("Time's up. Just the lines still to finish, then you're done.")).toBeVisible();
  await expect(page.getByText('Say it aloud from the first letters, then reveal it.')).toBeVisible();
  await shot(page, 'card-closing');
  await answerCard(page); // the first letters
  await answerCard(page); // From the cue alone: nothing is left to finish, so the sprint ends here
  await expect(page.getByRole('heading', { name: 'Sprint done' })).toBeVisible();
  await expect(page.getByText('1 answer, 1 word perfect.')).toBeVisible();
  await expect(page.getByText('Stand up, drink some water', { exact: false })).toBeVisible();
  await shot(page, 'sprint-done');
  await page.getByRole('button', { name: 'Stop for now' }).click();
  await page.evaluate(() => window.offScript.go('sprint', { minutes: 0.02 }));
  await page.waitForTimeout(1300);
  for (let i = 0; i < 4; i++) await answerCard(page); // teach, read, the first letters, then without
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

test('the keypad by touch: each tap types once, even the same key twice in a row', async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await page.getByRole('button', { name: 'Try it' }).click();
  await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Cast', exact: true }).click();
  const keys = await keysOf(page);
  expect(keys).toMatch(/(.)\1/); // "who waited": the same first letter twice in a row
  await page.waitForTimeout(400); // a touch just as the keypad comes up is the second tap of a double tap
  for (const k of keys) {
    const box = await page.locator(`.keypad button[data-key="${k}"]`).boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  }
  await expect(page.locator('.result.perfect')).toBeVisible();
});

test('on a short screen, a long cue and line: the line being typed stays above the keypad', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 600 });
  await importScript(page);
  await page.evaluate(() => {
    // The first line's cue made long, as uniqueCues does for a cue that leads to more than one line.
    const items = window.offScript.model.items;
    const lead = [items[5], items[6], items[7]];
    const lines = [{ speaker: items[4].speaker, text: items[4].cue.text }, ...lead.map((x) => ({ speaker: x.speaker, text: x.text }))];
    window.offScript.index.cues.set(items[0].id, { ...items[0].cue, lead: lead.map((x) => x.id), lines, nth: 2 });
  });
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await page.getByRole('button', { name: 'Try it' }).click();
  await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Cast', exact: true }).click();
  const keys = await keysOf(page);
  const below = () => page.evaluate(() => document.querySelector('.line.answer').getBoundingClientRect().bottom - document.querySelector('footer').getBoundingClientRect().top);
  await page.keyboard.type(keys.slice(0, -1));
  expect(await below()).toBeLessThanOrEqual(0);
  await page.keyboard.type(keys.slice(-1));
  await expect(page.locator('.result.perfect')).toBeVisible();
  const result = await page.evaluate(() => document.querySelector('.result').getBoundingClientRect().bottom - document.querySelector('footer').getBoundingClientRect().top);
  expect(result).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  expect(await page.evaluate(() => window.scrollY)).toBe(0); // the next card starts at its cue
});

test('a slip of the finger: a wrong key touching the right one can be counted right, and undone', async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await page.getByRole('button', { name: 'Try it' }).click();
  await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Cast', exact: true }).click();
  const keys = await keysOf(page);
  expect(keys[0]).toBe('w');
  await page.keyboard.type('e' + keys.slice(1)); // e touches w
  await expect(page.locator('.result.misses')).toHaveText(/One miss: We/);
  await shot(page, 'card-result-slip');
  await page.getByRole('button', { name: 'A slip of the finger? Count it right' }).click();
  await expect(page.locator('.result.perfect')).toHaveText(/Counted right: a slip of the finger/);
  expect(await page.evaluate(() => window.offScript.events.map((e) => [e.pass, !!e.slip]))).toEqual([[true, true]]);
  await page.getByRole('button', { name: 'Undo last answer' }).click();
  await expect(page.getByText('Who speaks next?')).toBeVisible();
  expect(await page.evaluate(() => window.offScript.events.length)).toBe(0);
  // A wrong key nowhere near the right one is a miss, with nothing to count it right. That word was
  // missed in this line once before (as if on an earlier day), so the result says so.
  await page.evaluate(() => window.offScript.events.push({ time: Date.now() - 86400000, day: '2026-10-25', id: window.offScript.card.item.id, pass: false, mode: 'type', misses: 1, missed: [0] }));
  await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Cast', exact: true }).click();
  await page.keyboard.type('p' + keys.slice(1));
  await expect(page.locator('.result.misses')).toHaveText(/One miss: We/);
  await expect(page.getByRole('button', { name: /slip of the finger/ })).toHaveCount(0);
  await expect(page.getByText('Missed here before as well: We.')).toBeVisible();
  await shot(page, 'card-result-trouble');
});

test('a long line right from its cue once: first letters only at the start of each phrase, a blank for every other word', async ({ page }) => {
  await importScript(page);
  const it = fixtureModel().model.items.find((x) => x.words >= 8);
  const starts = phraseStarts(it.tokens);
  const want = joinTokens(it.tokens, (t, i) => (t.k === null || starts.has(i) ? firstLettersOf(t) : blankOf(t)));
  await seedOnce(page, it.id);
  await expect(page.getByRole('heading', { name: 'Check', exact: true })).toBeVisible();
  await expect(page.getByText('As a line gets stronger, it shows fewer first letters. Say every word, the blanks too.')).toBeVisible();
  await expect(page.getByText('Say it aloud, blanks too, then reveal it.')).toBeVisible();
  const line = page.locator('.answer-area .line');
  await expect(line.locator('.blank')).toHaveCount(it.tokens.filter((t, i) => t.k !== null && !starts.has(i)).length);
  const seen = await line.evaluate((p) => {
    const copy = p.cloneNode(true);
    copy.querySelectorAll('.visually-hidden').forEach((n) => n.remove());
    return copy.textContent;
  });
  expect(seen).toBe(want);
  // What VoiceOver reads: each blank as "blank", with its punctuation for the pauses.
  const heard = await line.evaluate((p) => {
    const copy = p.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    return copy.textContent.replace(/\s+/g, ' ').trim();
  });
  const squash = (x) => x.replace(/\s+/g, ' ').trim();
  expect(heard).toBe(squash(joinTokens(it.tokens, (t, i) => (t.k === null || starts.has(i) ? firstLettersOf(t) : ` ${blankOf(t).replace('_', 'blank')} `))));
  await shot(page, 'card-help-phrases');
  await page.getByRole('button', { name: 'Reveal' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.result.perfect')).toHaveText(/Right with the first letters/);
});

test('after off script day: Today says so, and a sprint takes a miss first, then the line just falling due, then the one slipped further', async ({ page }) => {
  await importScript(page);
  const [missed, justDue, slipped] = await page.evaluate(() => {
    const o = window.offScript;
    Object.assign(o.settings, { lastNewDay: '2020-01-01', deadline: '2020-01-02', showDay: '2099-01-01' });
    const day = o.today();
    const hours = (n) => Date.now() - n * 3600000;
    const put = (id, stability, lastTime, lastResult) =>
      o.states.set(id, { id, status: 'review', firstDay: day, learnedDay: day, passes: 3, misses: 0, helped: 1, lapses: 0, stability, passDays: [day], missDays: [], lastResult, lastDay: day, lastTime, lastMode: 'type' });
    for (const it of o.model.items) put(it.id, 2000, hours(1), 'pass'); // everything strong: nothing else ready
    const ids = [o.model.scenes[3].itemIds[4], o.model.scenes[1].itemIds[2], o.model.scenes[1].itemIds[8]];
    put(ids[0], 1, hours(1), 'miss');
    put(ids[1], 1, hours(2), 'pass'); // 83% now
    put(ids[2], 1, hours(6), 'pass'); // 64% now
    o.go('today');
    return ids;
  });
  await expect(page.getByText('Checks now take the lines just falling due first, so the fewest slip; any that have slipped further come round as time allows.')).toBeVisible();
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await page.waitForFunction(() => window.offScript.card);
  const goes = [];
  for (const id of [missed, justDue, slipped]) {
    const shown = await page.evaluate(() => window.offScript.card.item.id);
    expect(shown).toBe(id);
    goes.push(await answerCard(page));
  }
  expect(goes).toEqual(['help', 'floor', 'help']); // the first letters for the miss and the line below 80%
});
