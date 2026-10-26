import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeApp, learn } from './helpers.mjs';
import { createSession, TEACH_FIRST_MESSAGE, AHEAD_MESSAGE, EXTRA_RUN_MESSAGE } from '../src/session.js';
import { makeResult } from '../src/grade.js';

const start = (app, opts = {}) =>
  createSession({ model: app.model, index: app.index, getPlan: app.plan, getState: app.getState, settings: app.settings, now: app.now, ...opts });

// Answers the current floor card; pass true or false.
function answer(app, s, pass) {
  const rec = s.answer(makeResult({ misses: pass ? [] : [0], mode: 'type' }));
  app.save(rec);
  return rec;
}

// Plays cards: on test cards chooses `onTest`, steps through front and back, answers floors with `decide(card)`.
function play(app, s, { decide = () => true, onTest = 'try', max = 500 } = {}) {
  const log = [];
  let card = s.advance();
  while (card && log.length < max) {
    log.push(`${card.queue}:${card.step}:${card.item.id}`);
    if (card.step === 'test') card = s.choose(onTest);
    else if (card.step === 'front' || card.step === 'back') card = s.choose('next');
    else {
      answer(app, s, decide(card));
      card = s.advance();
    }
  }
  return log;
}

test('day one: everything is new, so the sprint starts with New, beat by beat', () => {
  const app = fakeApp();
  const plan = app.plan();
  assert.equal(plan.tests.length, 0);
  assert.ok(plan.newBeats.length >= 1);
  const c = start(app).advance();
  assert.equal(c.queue, 'new');
  assert.equal(c.step, 'test');
  assert.equal(c.item.id, app.model.beats[0].itemIds[0]);
});

test('test first: Try it goes to Floor, Teach me goes to Front, Back, Floor', () => {
  const app = fakeApp();
  const s = start(app);
  s.advance();
  assert.equal(s.choose('teach').step, 'front');
  assert.ok(s.card.prompt);
  assert.equal(s.choose('next').step, 'back');
  assert.equal(s.choose('next').step, 'floor');
});

test('a missed pretest goes to Front; later misses go to Back; three misses go back to Front', () => {
  const app = fakeApp();
  const s = start(app);
  s.advance();
  s.choose('try');
  answer(app, s, false);
  assert.equal(s.advance().step, 'front');
  s.choose('next');
  s.choose('next');
  answer(app, s, false);
  assert.equal(s.advance().step, 'back');
  s.choose('next');
  answer(app, s, false);
  assert.equal(s.advance().step, 'back');
  s.choose('next');
  answer(app, s, false);
  assert.equal(s.advance().step, 'front');
});

test('two misses in the first three tries switch the beat to teaching first, with one line', () => {
  const app = fakeApp();
  const s = start(app);
  const beat = app.model.beats[0];
  s.advance();
  s.choose('try');
  answer(app, s, false);
  s.advance();
  s.choose('next');
  s.choose('next');
  answer(app, s, true);
  let card = s.advance();
  assert.equal(card.item.id, beat.itemIds[1]);
  assert.equal(card.step, 'test');
  s.choose('try');
  answer(app, s, false);
  card = s.advance();
  assert.equal(card.step, 'front');
  assert.equal(card.message, TEACH_FIRST_MESSAGE);
  s.choose('next');
  s.choose('next');
  answer(app, s, true);
  card = s.advance();
  assert.equal(card.item.id, beat.itemIds[2]);
  assert.equal(card.step, 'front');
  assert.equal(card.message, undefined);
});

test('a beat is learned line by line, then run twice with another beat learned in between', () => {
  const app = fakeApp({ settings: { lastNewDay: '2026-10-26' } }); // everything is new today
  const log = play(app, start(app));
  const [b1, b2] = app.model.beats;
  const firstOf = (b) => b.itemIds[0];
  assert.deepEqual(log.filter((l) => l.startsWith('new:test')).slice(0, 4), b1.itemIds.map((id) => `new:test:${id}`));
  const runStarts = log.map((l, i) => [l, i]).filter(([l]) => l.startsWith('beat:floor:') && (l.endsWith(firstOf(b1)) || l.endsWith(firstOf(b2))));
  assert.deepEqual(runStarts.slice(0, 4).map(([l]) => l.split(':')[2]), [firstOf(b1), firstOf(b1), firstOf(b2), firstOf(b2)]);
  const b2LearnAt = log.indexOf(`new:test:${firstOf(b2)}`);
  assert.ok(runStarts[0][1] < b2LearnAt && b2LearnAt < runStarts[1][1], 'second run of beat 1 comes after learning beat 2');
  for (const id of b1.itemIds) assert.equal(app.getState(id).status, 'review');
});

test('a miss in a beat run is relearned (Back, Floor) before the run goes on', () => {
  const app = fakeApp();
  const b1 = app.model.beats[0];
  let missed = false;
  const log = play(app, start(app), {
    decide: (card) => {
      if (card.queue === 'beat' && card.item.id === b1.itemIds[1] && !missed) {
        missed = true;
        return false;
      }
      return true;
    },
    max: 40,
  });
  const i = log.indexOf(`beat:floor:${b1.itemIds[1]}`);
  assert.deepEqual(log.slice(i, i + 4), [`beat:floor:${b1.itemIds[1]}`, `beat:back:${b1.itemIds[1]}`, `beat:floor:${b1.itemIds[1]}`, `beat:floor:${b1.itemIds[2]}`]);
  const ev = app.events.find((e) => e.queue === 'beat' && e.relearn);
  assert.equal(ev.id, b1.itemIds[1], 'the check straight after relearning is marked, so it does not count as memory');
});

test('older lines are tested in between new beats: up to six, the most at risk first', () => {
  const app = fakeApp();
  const [b0, b1, b3] = [app.model.beats[0].itemIds, app.model.beats[1].itemIds, app.model.beats[3].itemIds];
  const firstDay = '2026-10-20'; // started on an earlier day, so today's new lines are still to come
  learn(app, [...b0, ...b1, ...b3], { stability: 48, hoursAgo: 1, firstDay });
  const ready = [b0[1], b1[0], b1[2], b1[3], b3[0], b3[2], b3[4]];
  ready.forEach((id, i) => learn(app, [id], { stability: 1, hoursAgo: 2 + i, firstDay })); // later in the list: more at risk
  const log = play(app, start(app), { max: 400 });
  const firstNew = log.findIndex((l) => l.startsWith('new:'));
  assert.deepEqual(log.slice(0, firstNew), [...ready].reverse().slice(0, 6).map((id) => `due:floor:${id}`));
  const roundEnd = log.findIndex((l, i) => i > firstNew && l.startsWith('due:'));
  assert.equal(log[roundEnd], `due:floor:${ready[0]}`, 'the last one waits until the new beat has had its run');
  assert.ok(log.slice(firstNew, roundEnd).some((l) => l.startsWith('beat:')));
});

test('a new line comes back on its own later the same day, then less often', () => {
  const app = fakeApp();
  play(app, start(app), { onTest: 'teach' });
  const b0 = app.model.beats[0].itemIds;
  assert.ok(b0.every((id) => app.getState(id).status === 'review'));
  assert.equal(app.plan().tests.length, 0, 'nothing ready straight after learning');
  app.wait(60);
  assert.ok(app.plan().tests.length > 0, 'an hour later the new lines are ready again');
  const before = b0.map((id) => app.getState(id).stability);
  play(app, start(app, { scope: 'tests' }));
  b0.forEach((id, i) => assert.ok(app.getState(id).stability > 2 * before[i], 'after that check they last much longer'));
  assert.ok(app.events.filter((e) => e.id === b0[1]).length >= 4, 'recalled at least four times on its first day');
});

test('a missed run line comes straight back as a check, and the run keeps flowing', () => {
  const app = fakeApp();
  learn(app, app.model.scenes[3].itemIds, { stability: 1, hoursAgo: 3 });
  const s = start(app, { scope: 'tests' });
  let card = s.advance();
  const runIds = [];
  while (card && card.queue === 'run') {
    runIds.push(card.item.id);
    answer(app, s, runIds.length !== 2); // miss the second line of the run
    card = s.advance();
  }
  assert.equal(runIds.length, 6, 'the run carried on after the miss');
  assert.deepEqual([card.queue, card.item.id], ['due', runIds[1]]);
});

test('undo restores the card and the item state', () => {
  const app = fakeApp();
  const s = start(app);
  s.advance();
  s.choose('try');
  const before = app.getState(s.card.item.id);
  const rec = answer(app, s, true);
  s.advance();
  app.undo();
  const card = s.restore(rec.snapshot);
  assert.equal(card.step, 'floor');
  assert.deepEqual(app.getState(card.item.id), before);
  assert.equal(app.events.length, 0);
});

test('a saved sprint carries on where it stopped', () => {
  const app = fakeApp();
  const s = start(app);
  s.advance();
  s.choose('teach');
  s.choose('next');
  const again = start(app, { saved: s.save() });
  assert.equal(again.card.step, 'back');
  assert.equal(again.card.item.id, s.card.item.id);
});

test('Just 2 minutes never starts new lines', () => {
  const app = fakeApp();
  assert.equal(start(app, { scope: 'tests' }).advance(), null);
});

test('keep going: a head start on new lines, or an extra run', () => {
  const app = fakeApp();
  const s = start(app);
  play(app, s);
  assert.equal(s.planDone, true);
  const card = s.keepGoing('new');
  assert.equal(card.queue, 'new');
  assert.equal(card.message, AHEAD_MESSAGE);
  const t = start(app);
  play(app, t);
  const run = t.keepGoing('runs');
  assert.equal(run.queue, 'run');
  assert.equal(run.message, EXTRA_RUN_MESSAGE);
});

test('Run this scene: a custom run over the given lines, misses flow on', () => {
  const app = fakeApp();
  const ids = app.model.scenes[1].itemIds;
  learn(app, ids, { stability: 48, hoursAgo: 1 });
  const log = play(app, start(app, { custom: { scene: 1, itemIds: ids } }), { decide: () => false });
  assert.equal(log.length, ids.length);
  assert.ok(log.every((l) => l.startsWith('run:floor:')));
});
