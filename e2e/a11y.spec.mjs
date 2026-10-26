// Accessibility: axe on every screen, in every theme. No serious or critical problems allowed.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { importScript, answerCard } from './helpers.mjs';

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

    // The second line's cue made longer, as uniqueCues does for a cue that leads to more than one line
    // (the invented play has none), so a long cue is checked too.
    await page.evaluate(() => {
      const [first, second] = window.offScript.model.items;
      const lines = [{ speaker: first.cue.speaker, text: first.cue.text }, { speaker: first.speaker, text: first.text }];
      window.offScript.index.cues.set(second.id, { ...second.cue, lead: [first.id], lines, nth: 2 });
    });
    await page.getByRole('button', { name: 'Start sprint' }).click();
    await page.waitForFunction(() => window.offScript.card);
    await check(page, 'card: test', found);
    await page.getByRole('button', { name: 'Try it' }).click();
    await check(page, 'card: who speaks', found);
    await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Keeper', exact: true }).click();
    await check(page, 'card: keypad', found);
    await page.keyboard.type('?zz');
    await check(page, 'card: typing', found);
    await page.keyboard.type('zzzzzzzzzz');
    await expect(page.locator('.result')).toBeVisible();
    await check(page, 'card: result', found);
    await page.getByRole('button', { name: 'Next', exact: true }).click(); // a missed try is taught: read it
    await check(page, 'card: front', found);
    await page.getByRole('button', { name: 'Next', exact: true }).click(); // then on through the beat
    await expect(page.getByText('The second time these lines come in the scene.')).toBeVisible();
    await check(page, 'card: a longer cue', found);
    await page.getByRole('button', { name: 'Try it' }).click();
    await page.getByRole('button', { name: 'Say it instead' }).click();
    await page.getByRole('group', { name: 'Who speaks next?' }).getByRole('button', { name: 'Keeper', exact: true }).click();
    await check(page, 'card: say before reveal', found);
    await page.getByRole('button', { name: 'Reveal' }).click();
    await check(page, 'card: say', found);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    // The rest of the beat is read, then the beat is run with the first letters.
    const letters = page.getByText('Say it aloud from the first letters, then reveal it.');
    for (let i = 0; i < 12 && !(await letters.count()); i++) await answerCard(page);
    await check(page, 'card: first letters', found);
    await page.getByRole('button', { name: 'Reveal' }).click();
    await check(page, 'card: first letters revealed', found);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('It comes back later without the first letters.')).toBeVisible();
    await check(page, 'card: first letters result', found);
    await page.getByRole('button', { name: 'Stop' }).click();

    await page.getByRole('button', { name: 'Choose what to practise' }).click();
    await expect(page.getByRole('heading', { name: 'Choose what to practise' })).toBeVisible(); // drawn once any saved practice is read
    await check(page, 'choose', found);
    await page.getByLabel('Which lines').selectOption({ label: 'Every line' });
    await check(page, 'choose: every line', found);
    await page.getByRole('button', { name: 'Today', exact: true }).click();

    await page.getByRole('button', { name: 'Scenes' }).click();
    await check(page, 'scenes', found);
    await page.getByRole('button', { name: /Scene 1: The Harbour/ }).click();
    await check(page, 'reader', found);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();

    await page.getByRole('button', { name: 'Settings' }).click();
    await check(page, 'settings', found);
    await page.getByRole('button', { name: 'Start again from 0%' }).click();
    await check(page, 'start again', found);
    await page.getByRole('button', { name: 'Keep my progress' }).click();
    await page.evaluate(() => window.offScript.go('again', { scene: 0 }));
    await check(page, 'start this scene again', found);
    await page.getByRole('button', { name: 'Keep its progress' }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
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
