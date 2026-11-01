import { test, expect, importScript, importPack } from './helpers.mjs';

const shot = (page, name) => page.screenshot({ path: `shots/${test.info().project.name}-${name}.png` });

test('audio pack: import, build a walk tape that can play, mark a line, review and save', async ({ page }) => {
  await importScript(page);
  await importPack(page);
  await page.getByRole('button', { name: 'Walk' }).click();
  await expect(page.getByText('keep one earbud out', { exact: false })).toBeVisible();
  await expect(page.getByText('A new line comes twice first: say it back in the gap after it.', { exact: false })).toBeVisible();
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
  await page.getByRole('button', { name: 'Another 15 minutes' }).click(); // the same length again, in one tap
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
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

// The walk screen, ready to play.
async function startWalk(page, length = '15 minutes') {
  await importScript(page);
  await importPack(page);
  await page.getByRole('button', { name: 'Walk' }).click();
  await page.getByRole('button', { name: length, exact: true }).click();
  await page.waitForFunction(() => window.offScript.walk && window.offScript.walk.player.audio.readyState >= 3, null, { timeout: 15000 });
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
}

const kept = (page) => expect.poll(() => page.evaluate(async () => !!(await window.offScript.store.get('walkDraft')))).toBe(true);

// Jumps the tape to the moment fn gives, as if the walk had got that far.
async function jump(page, fn) {
  const at = await page.evaluate(`(() => { const { tape, player } = window.offScript.walk; const at = (${fn})(tape); player.seek(at); return at; })()`);
  await page.waitForFunction((t) => Math.abs(window.offScript.walk.player.time - t) < 0.5, at);
  return at;
}

test('a line being taught: Missed that one counts it as needing help, Hear it again goes back to it', async ({ page }) => {
  await startWalk(page);
  await page.evaluate(() => window.offScript.walk.player.pause());
  await jump(page, (tape) => tape.teaching[0].start + 3);
  await page.getByRole('button', { name: 'Hear it again' }).click();
  await page.waitForFunction(() => {
    const { tape, player } = window.offScript.walk;
    return Math.abs(player.time - tape.teaching[0].start) < 0.5;
  });
  await jump(page, (tape) => tape.teaching[0].start + 3);
  await page.getByRole('button', { name: 'Missed that one' }).click();
  await expect(page.getByText('1 line marked as missed.')).toBeVisible();
  await page.getByRole('button', { name: 'End walk' }).click();
  await expect(page.getByRole('heading', { name: 'How did it go?' })).toBeVisible();
  await expect(page.locator('.review-list input:checked')).toHaveCount(1);
  await page.getByRole('button', { name: 'All good apart from the ticked ones' }).click();
  await expect(page.getByRole('heading', { name: 'Walk saved' })).toBeVisible();
  const state = await page.evaluate(() => {
    const o = window.offScript;
    const ev = o.events.filter((e) => e.mode === 'walk');
    return { n: ev.length, pass: ev[0].pass, passes: o.getState(ev[0].id).passes };
  });
  expect(state).toEqual({ n: 1, pass: false, passes: 0 });
});

test('a mark made in a gap reaches the review, and the count agrees with it', async ({ page }) => {
  await startWalk(page);
  await jump(page, (tape) => tape.trials[1].answerEnd + 0.5);
  await page.getByRole('button', { name: 'Missed that one' }).click();
  await expect(page.getByText('1 line marked as missed.')).toBeVisible();
  await jump(page, (tape) => tape.trials[2].start + 2.5); // past the two seconds that still mean the line before
  await page.getByRole('button', { name: 'Missed that one' }).click();
  await expect(page.getByText('2 lines marked as missed.')).toBeVisible();
  await page.getByRole('button', { name: 'End walk' }).click();
  await expect(page.locator('.review-list input:checked')).toHaveCount(2);
});

test('after a pause the tape picks up from the line\'s cue, not in the middle of its gap', async ({ page }) => {
  await startWalk(page);
  await jump(page, (tape) => tape.trials[1].start + 0.6);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForFunction(() => {
    const { tape, player } = window.offScript.walk;
    return player.time < tape.trials[1].start && player.time >= tape.trials[1].replayFrom - 0.1;
  });
});

test('the screen and the lock screen say what to do now', async ({ page }) => {
  await startWalk(page);
  await jump(page, (tape) => tape.trials[1].start + 0.3);
  await expect(page.getByText('Your turn: say your line')).toBeVisible();
  await jump(page, (tape) => tape.teaching[0].start + 0.1);
  await expect(page.getByText('New line: just listen')).toBeVisible();
});

test('the tape ends and the page is lost: the walk comes back into its review, once', async ({ page }) => {
  await startWalk(page);
  await jump(page, (tape) => tape.trials[0].answerEnd + 0.5);
  await page.getByRole('button', { name: 'Missed that one' }).click();
  await expect(page.getByText('1 line marked as missed.')).toBeVisible();
  const rows = await page.evaluate(() => new Set(window.offScript.walk.tape.trials.map((t) => t.id)).size);
  await jump(page, (tape) => tape.duration - 0.5);
  await expect(page.getByRole('heading', { name: 'How did it go?' })).toBeVisible();
  await kept(page);
  await page.reload(); // the phone clears the page
  await expect(page.getByText('Your last walk is waiting to be saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Save it' }).click();
  await expect(page.getByRole('heading', { name: 'How did it go?' })).toBeVisible();
  await expect(page.getByText('Here is your last walk.', { exact: false })).toBeVisible();
  await expect(page.locator('.review-list li')).toHaveCount(rows);
  await expect(page.locator('.review-list input:checked')).toHaveCount(1);
  await page.getByRole('button', { name: 'All good apart from the ticked ones' }).click();
  await expect(page.getByRole('heading', { name: 'Walk saved' })).toBeVisible();
  expect(await page.evaluate(() => window.offScript.store.get('walkDraft'))).toBeUndefined();
  expect(await page.evaluate(() => window.offScript.events.filter((e) => e.mode === 'walk' && !e.pass).length)).toBe(1);
  await page.getByRole('button', { name: 'A different length' }).click();
  await expect(page.getByRole('heading', { name: 'How long?' })).toBeVisible();
});

test('the page is lost part way through a walk: what was heard is kept', async ({ page }) => {
  await startWalk(page);
  await jump(page, (tape) => tape.trials[3].answerEnd + 0.5);
  await kept(page);
  await page.reload();
  await page.getByRole('button', { name: 'Walk' }).click();
  await expect(page.getByRole('heading', { name: 'How did it go?' })).toBeVisible();
  await expect(page.locator('.review-list li')).not.toHaveCount(0);
});

test('let go of a kept walk and it does not come back', async ({ page }) => {
  await startWalk(page);
  await jump(page, (tape) => tape.duration - 0.5);
  await expect(page.getByRole('heading', { name: 'How did it go?' })).toBeVisible();
  await page.getByRole('button', { name: 'Don’t count this one' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.getByRole('button', { name: 'Walk' }).click();
  await expect(page.getByRole('heading', { name: 'How long?' })).toBeVisible();
});

test('Back in a walk that has started keeps what was heard', async ({ page }) => {
  await startWalk(page);
  await jump(page, (tape) => tape.trials[1].answerEnd + 0.5);
  await page.getByRole('button', { name: /Back/ }).first().click();
  await expect(page.getByRole('heading', { name: 'How did it go?' })).toBeVisible();
});

test('ending a walk before the first go says so kindly, and nothing is kept', async ({ page }) => {
  await startWalk(page);
  await page.getByRole('button', { name: 'End walk' }).click();
  await expect(page.getByRole('heading', { name: 'Walk ended' })).toBeVisible();
  await expect(page.getByText('You stopped before your first go at a line', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => window.offScript.store.get('walkDraft'))).toBeUndefined();
});

test('a tape that will not play carries on in the phone\'s voice, from the same line, with its marks', async ({ page }) => {
  await startWalk(page);
  await jump(page, (tape) => tape.trials[1].start + 0.6);
  await page.getByRole('button', { name: 'Missed that one' }).click();
  await expect(page.getByText('1 line marked as missed.')).toBeVisible();
  await page.evaluate(() => window.offScript.walk.player.audio.dispatchEvent(new Event('error')));
  await expect(page.getByText('The audio would not play, so the phone will read it aloud instead.')).toBeVisible();
  await expect(page.getByText('1 line marked as missed.')).toBeVisible();
  await page.getByRole('button', { name: 'End walk' }).click();
  await expect(page.getByRole('heading', { name: 'How did it go?' })).toBeVisible();
  await expect(page.locator('.review-list input:checked')).toHaveCount(1);
});

test('audio missing from the pack: the phone reads the walk aloud instead', async ({ page }) => {
  await importScript(page);
  await importPack(page);
  await page.evaluate(() => {
    const o = window.offScript;
    const real = o.store.getClips;
    o.store.getClips = async (names) => {
      const got = await real(names);
      got.delete(names[0]);
      return got;
    };
  });
  await page.getByRole('button', { name: 'Walk' }).click();
  await page.getByRole('button', { name: '15 minutes', exact: true }).click();
  await expect(page.getByText('Some of the audio is missing, so the phone will read it aloud instead.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Got it' })).toBeVisible();
});

test('Start again: a kept walk goes with the progress it was part of', async ({ page }) => {
  await startWalk(page);
  await jump(page, (tape) => tape.trials[3].answerEnd + 0.5);
  await kept(page);
  await page.evaluate(() => window.offScript.store.clearProgress());
  expect(await page.evaluate(() => window.offScript.store.get('walkDraft'))).toBeUndefined();
});

test('the spoken coach can be turned off in Settings; the steps stay on the screen', async ({ page }) => {
  await importScript(page);
  const coach = async () => {
    await page.getByRole('button', { name: 'Walk' }).click();
    await page.getByRole('button', { name: '15 minutes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Got it' })).toBeVisible();
    const said = await page.evaluate(() => window.offScript.walk.tape.steps.filter((s) => s.clip && s.clip.startsWith('coach:')).length);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
    return said;
  };
  expect(await coach()).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('A voice says what to do on walks').uncheck();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  expect(await coach()).toBe(0);
  expect(await page.evaluate(() => window.offScript.walk.tape.guide.length)).toBeGreaterThan(0);
});

test('a pack with the coach: the tape says what to do, in clips that are there to play', async ({ page }) => {
  await importScript(page);
  await importPack(page, { coach: true });
  await page.getByRole('button', { name: 'Walk' }).click();
  await page.getByRole('button', { name: '15 minutes', exact: true }).click();
  await page.waitForFunction(() => window.offScript.walk && window.offScript.walk.player.audio.readyState >= 3, null, { timeout: 15000 });
  const said = await page.evaluate(() => window.offScript.walk.tape.steps.filter((s) => s.clip && s.clip.startsWith('coach-')).length);
  expect(said).toBeGreaterThan(5);
  await expect(page.getByText('Some of the audio is missing', { exact: false })).toHaveCount(0);
});

test('a pack that an older version imported has no coach clips: the walk plays without them, in the pack\'s voice', async ({ page }) => {
  await importScript(page);
  await importPack(page, { coach: true });
  await page.evaluate(() => {
    const o = window.offScript;
    const real = o.store.getClips;
    o.store.getClips = async (names) => {
      const got = await real(names);
      for (const name of names) if (name.startsWith('coach-')) got.delete(name);
      return got;
    };
  });
  await page.getByRole('button', { name: 'Walk' }).click();
  await page.getByRole('button', { name: '15 minutes', exact: true }).click();
  await page.waitForFunction(() => window.offScript.walk && window.offScript.walk.player && window.offScript.walk.player.audio.readyState >= 3, null, { timeout: 15000 });
  await expect(page.getByText('Some of the audio is missing', { exact: false })).toHaveCount(0);
  expect(await page.evaluate(() => window.offScript.walk.tape.steps.filter((s) => s.clip && s.clip.startsWith('coach-')).length)).toBe(0);
});
