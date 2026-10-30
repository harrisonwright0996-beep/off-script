import { test, expect, importScript, answerCard } from './helpers.mjs';

const shot = (page, name) => page.screenshot({ path: `shots/${test.info().project.name}-${name}.png` });
const cardId = (page) => page.evaluate(() => window.offScript.card.item.id);

// Carry on, then wait for the card it brings (the last card shown stays in window.offScript until then).
async function carryOn(page) {
  await page.evaluate(() => (window.offScript.card = null));
  await page.getByRole('button', { name: 'Carry on' }).click();
  await page.waitForFunction(() => window.offScript.card);
}

test('choose what to practise: a scene, every line, read it first; stopped part way, it carries on', async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Choose what to practise' }).click();
  await expect(page.getByRole('heading', { name: 'Choose what to practise' })).toBeVisible();
  await expect(page.getByText('No lines match these choices. Try Every line.')).toBeVisible(); // nothing started yet
  await expect(page.getByRole('button', { name: 'Start' })).toBeDisabled();
  await page.getByLabel('Where').selectOption({ label: 'Scene 1: The Harbour' });
  await page.getByLabel('Which lines').selectOption({ label: 'Every line' });
  await page.getByLabel('How much help').selectOption({ label: 'Read it first' });
  await expect(page.getByText('Read each line, say it from the first letters, then later without.')).toBeVisible();
  await expect(page.getByText(/^13 lines, \d+ words: about \d+ minutes at a typical pace\.$/)).toBeVisible();
  await shot(page, 'choose');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { name: 'Run: Scene 1: The Harbour' })).toBeVisible();
  await expect(page.getByText('Line 1 of 13', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => window.offScript.card.step)).toBe('front');
  expect(await answerCard(page)).toBe('front'); // read it
  expect(await answerCard(page)).toBe('help'); // then the first letters
  const at = await cardId(page);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Choose what to practise' }).click();
  await expect(page.getByText('Part way through: Scene 1: The Harbour, every line. 13 lines still to go.')).toBeVisible();
  await expect(page.getByLabel('Where')).toHaveValue('1'); // his last choices are remembered
  await expect(page.getByLabel('How much help')).toHaveValue('read');
  await carryOn(page);
  expect(await cardId(page)).toBe(at);

  // The day's sprint is its own: it starts where it would have.
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'Start sprint' }).click();
  await expect(page.getByRole('heading', { name: 'New', exact: true })).toBeVisible();
});

test('a chosen practice at time up: Sprint done says what is left, and Carry on goes on with it', async ({ page }) => {
  await importScript(page);
  await page.evaluate(() => (window.offScript.settings.sprintMinutes = 0.02)); // a one second sprint
  const ids = await page.evaluate(() => window.offScript.model.items.map((it) => it.id));
  await page.getByRole('button', { name: 'Choose what to practise' }).click();
  await page.getByLabel('Which lines').selectOption({ label: 'Every line' });
  await page.getByLabel('How much help').selectOption({ label: 'No help' });
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForTimeout(1300);
  expect(await answerCard(page)).toBe('floor'); // from the cue alone; time is up after it
  await expect(page.getByRole('heading', { name: 'Sprint done' })).toBeVisible();
  await expect(page.getByText(`${ids.length - 1} lines of this practice still to go.`)).toBeVisible();
  await carryOn(page);
  expect(await cardId(page)).toBe(ids[1]);
});

test('a chosen practice to the end: Practice done, then Choose again with nothing left over', async ({ page }) => {
  await importScript(page);
  await page.getByRole('button', { name: 'Choose what to practise' }).click();
  await page.getByLabel('Where').selectOption({ label: 'Prologue' });
  await page.getByLabel('Which lines').selectOption({ label: 'Every line' });
  await page.getByLabel('How much help').selectOption({ label: 'No help' });
  await page.getByRole('button', { name: 'Start' }).click();
  for (let i = 0; i < 4; i++) expect(await answerCard(page)).toBe('floor');
  await expect(page.getByRole('heading', { name: 'Practice done' })).toBeVisible();
  await expect(page.getByText('Prologue, every line.')).toBeVisible();
  await expect(page.getByText('4 answers, 4 word perfect.')).toBeVisible();
  await shot(page, 'practice-done');
  await page.getByRole('button', { name: 'Choose again' }).click();
  await expect(page.getByRole('heading', { name: 'Choose what to practise' })).toBeVisible();
  await expect(page.getByText('Part way through', { exact: false })).toHaveCount(0);
});

// Learned earlier today: the Prologue and the first three lines of Scene 1. Their ids, in script order.
async function learnedToday(page) {
  const ids = await page.evaluate(() => {
    const o = window.offScript;
    const day = o.today();
    const time = Date.now() - 2 * 3600000;
    const ids = [...o.model.scenes[0].itemIds, ...o.model.scenes[1].itemIds.slice(0, 3)];
    for (const id of ids) {
      o.states.set(id, { id, status: 'review', firstDay: day, learnedDay: day, passes: 2, misses: 0, helped: 1, lapses: 0, stability: 24, passDays: [day], missDays: [], lastResult: 'pass', lastDay: day, lastTime: time, lastMode: 'type' });
    }
    o.go('today');
    return ids;
  });
  await expect(page.getByRole('button', { name: 'Just 2 minutes' })).toBeVisible();
  return ids;
}

test('Run through: everything learned so far in script order; a miss carries on and comes back after that run; its choices are its own', async ({ page }) => {
  await importScript(page);
  const learned = await learnedToday(page);
  await page.getByRole('button', { name: 'Run through' }).click();
  await expect(page.getByRole('heading', { name: 'Run through' })).toBeVisible();
  await expect(page.getByText('In script order, scene by scene. A miss shows the line and carries on; it comes back after that run.')).toBeVisible();
  await expect(page.getByLabel('Where')).toHaveValue('null'); // the whole play
  await expect(page.getByLabel('Which lines').locator('option')).toHaveText(['Everything learned so far', 'Every line']);
  await expect(page.getByLabel('How much help')).toHaveValue('cue'); // from the cue first, help after a miss
  await page.getByLabel('How much help').selectOption({ label: 'No help' });
  await expect(page.getByText(/^7 lines, \d+ words: under 5 minutes at a typical pace\.$/)).toBeVisible();
  await shot(page, 'run-through');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { name: 'Run: Prologue' })).toBeVisible();
  await expect(page.getByText('Line 1 of 4', { exact: false })).toBeVisible();
  const shown = [];
  for (let i = 0; i < 8; i++) {
    shown.push(await cardId(page));
    expect(await answerCard(page, { miss: i === 1 })).toBe('floor');
  }
  expect(shown).toEqual([...learned, learned[1]]); // in order, then the miss once the Scene 1 run is done
  await expect(page.getByRole('heading', { name: 'Run through done' })).toBeVisible();
  await expect(page.getByText('The whole play, everything learned so far.')).toBeVisible();
  await expect(page.getByText('8 answers, 7 word perfect.')).toBeVisible();
  await page.getByRole('button', { name: 'Run through again' }).click();
  await expect(page.getByRole('heading', { name: 'Run through' })).toBeVisible();
  await expect(page.getByLabel('How much help')).toHaveValue('none'); // remembered for Run through
  await expect(page.getByText('Part way through', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Choose what to practise' }).click();
  await expect(page.getByLabel('How much help')).toHaveValue('auto'); // Choose what to practise keeps its own
  await expect(page.getByLabel('Which lines').locator('option')).toHaveCount(3);
});

test('Run through from the cue first: lines learned today are asked from the cue alone; a miss comes back with the first letters, then without', async ({ page }) => {
  await importScript(page);
  const learned = await learnedToday(page);
  await page.getByRole('button', { name: 'Run through' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { name: 'Run: Prologue' })).toBeVisible();
  const goes = [];
  for (let i = 0; i < 10; i++) {
    const id = await cardId(page);
    goes.push(`${await answerCard(page, { miss: i === 1 })}:${learned.indexOf(id)}`);
  }
  // The miss is not asked straight after its first letters: the first line comes in between.
  expect(goes).toEqual([...learned.map((_, i) => `floor:${i}`), 'help:1', 'floor:0', 'floor:1']);
  await expect(page.getByRole('heading', { name: 'Run through done' })).toBeVisible();
  await expect(page.getByText('9 answers, 8 word perfect.')).toBeVisible();
});
