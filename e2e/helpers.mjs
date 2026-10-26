// Shared steps for the browser tests. Only the invented play is ever loaded.
import { expect } from '@playwright/test';
import { buildFixtureDocx } from '../tests/fixtures/night-ferry.mjs';

export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Opens the app; in the iPhone browser it first asks to be installed, which tests skip.
export async function open(page, url = './') {
  await page.goto(url);
  const carryOn = page.getByRole('button', { name: 'Continue in Safari for now' });
  const welcome = page.getByRole('heading', { name: 'Off Script', exact: true });
  const today = page.getByRole('heading', { name: 'Today', exact: true });
  await expect(carryOn.or(welcome).or(today)).toBeVisible();
  if (await carryOn.isVisible()) await carryOn.click();
}

export async function chooseFile(page, buttonName, file) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  await (await chooser).setFiles(file);
}

export async function importScript(page, url) {
  await open(page, url);
  await chooseFile(page, 'Choose the script', { name: 'Night Ferry.docx', mimeType: DOCX, buffer: Buffer.from(buildFixtureDocx()) });
  await expect(page.getByRole('heading', { name: 'Is this the script?' })).toBeVisible();
  await expect(page.getByText('4 scenes, 22 speeches, 143 words to learn.')).toBeVisible();
  await page.getByRole('button', { name: 'Yes, use this script' }).click();
  await expect(page.getByRole('heading', { name: 'Your dates' })).toBeVisible();
  await page.getByRole('button', { name: 'Looks right' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
}

// The keys for the line on show: one first letter or digit per word.
export const keysOf = (page) => page.evaluate(() => window.offScript.card.item.tokens.filter((t) => t.k !== null).map((t) => t.k).join(''));

// Answers whatever card is on show, the way he would: teach new lines, choose the right speaker,
// type the line. miss: type a wrong first key. Returns the card's step.
export async function answerCard(page, { miss = false } = {}) {
  await page.waitForFunction(() => window.offScript && window.offScript.card && document.querySelector('h1').textContent === window.offScript.card.label);
  const card = await page.evaluate(() => {
    const c = window.offScript.card;
    return { key: c.key, step: c.step, label: c.label, speaker: c.item.speaker, ask: !!c.askSpeaker };
  });
  if (card.step === 'test') await page.getByRole('button', { name: 'Teach me' }).click();
  else if (card.step === 'front' || card.step === 'back') await page.getByRole('button', { name: 'Next', exact: true }).click();
  else {
    if (card.ask) await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: card.speaker, exact: true }).click();
    const keys = await keysOf(page);
    await page.keyboard.type(miss ? (keys[0] === 'z' ? 'x' : 'z') + keys.slice(1) : keys);
    await expect(page.locator('.result')).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  // Wait for the next card, or for a screen that is not a card (sprint done, plan done).
  await page.waitForFunction(([k, label]) => window.offScript.card.key !== k || document.querySelector('h1').textContent !== label, [card.key, card.label]);
  return card.step;
}
