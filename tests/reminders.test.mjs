import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextNudge, nudgeText, VAPID_PUBLIC, WORKER } from '../src/reminders.js';
import { dayEnd } from '../src/dates.js';
import { fakeApp, learn } from './helpers.mjs';

const HOUR = 3600000;
const ids = (app) => app.model.items.map((it) => it.id);
const nudge = (app) => nextNudge({ plan: app.plan(), settings: app.settings });

test('while today’s plan is not done, the next nudge is 3 hours on', () => {
  const app = fakeApp();
  assert.equal(app.plan().done, false);
  assert.equal(nudge(app), app.clock + 3 * HOUR);
});

test('with today’s plan done and new lines left, nothing until tomorrow', () => {
  const app = fakeApp();
  const plan = { ...app.plan(), done: true, ahead: ['b1'], nextAt: app.clock + HOUR };
  assert.equal(nextNudge({ plan, settings: app.settings }), dayEnd(app.today));
});

test('with only upkeep left, it waits for the next line to fall due, up to a week', () => {
  const app = fakeApp({ today: '2026-11-20' });
  learn(app, ids(app), { stability: 2000, hoursAgo: 1 });
  const plan = app.plan();
  assert.equal(plan.done, true);
  assert.equal(plan.ahead.length, 0);
  assert.ok(plan.nextAt > app.clock + 7 * 24 * HOUR, 'nothing due for a long time');
  assert.equal(nudge(app), app.clock + 7 * 24 * HOUR);
  const soon = { ...plan, nextAt: app.clock + 2 * 24 * HOUR };
  assert.equal(nextNudge({ plan: soon, settings: app.settings }), soon.nextAt);
  const tonight = { ...plan, nextAt: app.clock + HOUR };
  assert.equal(nextNudge({ plan: tonight, settings: app.settings }), dayEnd(app.today), 'never twice in a day once the plan is done');
});

test('the days every line is checked come round, however strong the lines', () => {
  for (const [today, want] of [['2026-12-08', '2026-12-10'], ['2026-11-02', '2026-11-02']]) {
    const app = fakeApp({ today });
    learn(app, ids(app), { stability: 2000, hoursAgo: 1 });
    const plan = { ...app.plan(), done: true, ahead: [] };
    assert.equal(nextNudge({ plan, settings: app.settings }), dayEnd(want), today);
  }
});

test('the words are true when the push comes: what is left, and no counts', () => {
  const app = fakeApp();
  const plan = app.plan();
  const text = (over, turn = 0) => nudgeText({ plan: { ...plan, ...over }, turn }).body;
  assert.match(text({ done: false }), /still to do/);
  assert.match(text({ done: true, ahead: ['b1'] }), /ready when you are/);
  assert.match(text({ done: true, ahead: [] }), /fade|keeps/);
  assert.notEqual(text({ done: false }, 0), text({ done: false }, 1));
  assert.equal(nudgeText({ plan }).title, 'Off Script');
});

test('a reminder never names a person or a line, and has no dashes and no numbers', () => {
  const app = fakeApp();
  const plan = app.plan();
  const all = [false, true].flatMap((done) => [[], ['b1']].flatMap((ahead) => [0, 1, 2, 3].map((turn) => nudgeText({ plan: { ...plan, done, ahead }, turn }).body)));
  assert.equal(new Set(all).size, 6);
  const words = app.model.items.map((it) => it.speaker).concat(app.model.items.flatMap((it) => it.text.split(/\s+/).filter((w) => w.length > 8)));
  for (const body of all) {
    assert.doesNotMatch(body, /[-–—\d]/);
    for (const w of words) assert.ok(!body.includes(w), w);
  }
});

test('the app points at its own worker, not the pupils’, and holds no private key', () => {
  assert.match(WORKER, /^https:\/\/off-script-reminders\./);
  assert.equal(Buffer.from(VAPID_PUBLIC, 'base64url').length, 65);
  const toml = readFileSync(new URL('../worker/wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /^name = "off-script-reminders"$/m);
  assert.match(toml, /^ORIGIN = "https:\/\/harrisonwright0996-beep\.github\.io"$/m);
  assert.doesNotMatch(toml, /PRIVATE/);
  assert.doesNotMatch(readFileSync(new URL('../src/reminders.js', import.meta.url), 'utf8'), /"d":|VAPID_PRIVATE/);
});

