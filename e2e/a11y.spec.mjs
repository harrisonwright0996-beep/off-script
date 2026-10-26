// Accessibility: axe on every screen, in every theme. No serious or critical problems allowed.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { importScript } from './helpers.mjs';

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
test.use({ bypassCSP: true }); // only so axe itself can be added to the page

async function check(page, where, found) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ path: AXE });
  const result = await page.evaluate(() =>
    window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }),
  );
  for (const v of result.violations) {
    found.push({ where, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) });
  }
}

for (const theme of ['cream', 'light', 'dark']) {
  test(`every screen in the ${theme} theme`, async ({ page }) => {
    const found = [];
    await page.goto('./');
    await check(page, 'first screen', found);
    await importScript(page);
    await page.evaluate((t) => window.offScript.saveSettings({ theme: t }), theme);
    await page.evaluate(() => window.offScript.go('today'));
    await check(page, 'today', found);

    await page.getByRole('button', { name: 'Start sprint' }).click();
    await page.waitForFunction(() => window.offScript.card);
    await check(page, 'card: test', found);
    await page.getByRole('button', { name: 'Teach me' }).click();
    await check(page, 'card: front', found);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await check(page, 'card: back', found);
    await page.getByRole('button', { name: 'Show words' }).click();
    await check(page, 'card: back with words', found);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await check(page, 'card: who speaks', found);
    await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Keeper', exact: true }).click();
    await check(page, 'card: keypad', found);
    await page.keyboard.type('?zz');
    await check(page, 'card: typing', found);
    await page.keyboard.type('zzzzzzzzzz');
    await expect(page.locator('.result')).toBeVisible();
    await check(page, 'card: result', found);
    await page.getByRole('button', { name: 'Next', exact: true }).click(); // a miss: first letters again
    await expect(page.getByText('Say it aloud from the first letters.')).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Say it instead' }).click();
    await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Cast', exact: true }).click();
    await check(page, 'card: say before reveal', found);
    await page.getByRole('button', { name: 'Reveal' }).click();
    await check(page, 'card: say', found);
    await page.getByRole('button', { name: 'Stop' }).click();

    await page.getByRole('button', { name: 'Scenes' }).click();
    await check(page, 'scenes', found);
    await page.getByRole('button', { name: /Scene 1: The Harbour/ }).click();
    await check(page, 'reader', found);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();

    await page.getByRole('button', { name: 'Settings' }).click();
    await check(page, 'settings', found);
    await page.getByRole('button', { name: 'Remove everything' }).click();
    await check(page, 'remove everything', found);
    await page.getByRole('button', { name: 'Keep everything' }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();

    await page.getByRole('button', { name: 'Walk' }).click();
    await check(page, 'walk', found);
    await page.getByRole('button', { name: '15 minutes' }).click();
    await page.getByRole('button', { name: 'End walk' }).waitFor();
    await check(page, 'walk: reading aloud', found);

    await page.evaluate(() => window.offScript.go('setup', { reimport: true }));
    await check(page, 'import again', found);

    for (const f of found) console.log(`${theme} | ${f.where} | ${f.impact} | ${f.id}: ${f.help} | ${f.nodes.join(', ')}`);
    expect(found.filter((f) => f.impact === 'serious' || f.impact === 'critical')).toEqual([]);
  });
}
