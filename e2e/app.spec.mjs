import { test, expect, importScript, answerCard } from './helpers.mjs';

test('first run: import the invented play, see the plan', async ({ page }) => {
  await importScript(page);
  await expect(page.getByText('0 of 143 words word perfect')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start sprint' })).toBeVisible();
  await page.screenshot({ path: `shots/${test.info().project.name}-today.png`, fullPage: true });
});
