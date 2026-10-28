import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeApp, learn } from './helpers.mjs';
import { createSession, linesLeft, TEACH_FIRST_MESSAGE, AHEAD_MESSAGE, EXTRA_RUN_MESSAGE, AGAIN_MESSAGE, CLOSING_MESSAGE, LETTERS_MESSAGE, SHUFFLE_MESSAGE, GAP, POOL, CHECK_EVERY, LONG } from '../src/session.js';
import { makeResult } from '../src/grade.js';

const start = (app, opts = {}) =>
  createSession({ model: app.model, index: app.index, getPlan: app.plan, getState: app.getState, settings: app.settings, now: app.now, ...opts });

// Learned on 20 October and right on three days since: secure, so checked from the cue alone first.
const SECURE = { firstDay: '2026-10-20', learnedDay: '2026-10-20', passDays: ['2026-10-21', '2026-10-22', '2026-10-23'] };

// Answers the current card, with the first letters or from the cue alone; pass true or false.
function answer(app, s, pass) {
  const rec = s.answer(makeResult({ misses: pass ? [] : [0], mode: s.card && s.card.step === 'help' ? 'say' : 'type' }));
  app.save(rec);
  return rec;
}

const where = (card) => `${card.label === 'Again' ? 'again' : card.queue}:${card.step}:${card.item.id}`;

// Plays cards: on test cards chooses `onTest`, reads front cards, answers the rest with `decide(card, log)`.
// close(log): true to call time once that answer is in.
function play(app, s, { decide = () => true, onTest = 'try', max = 500, close = () => false } = {}) {
  const log = [];
  let card = s.advance();
  while (card && log.length < max) {
    log.push(where(card));
    if (card.step === 'test') card = s.choose(onTest);
    else if (card.step === 'front') card = s.choose('next') || s.advance();
    else {
      answer(app, s, decide(card, log));
      if (close(log)) s.close();
      card = s.advance();
    }
  }
  return log;
}

// Misses the first go of each line in `ids` this sprint, gets everything else right.
const missFirst = (ids) => (card, log) => !(ids.includes(card.item.id) && log.filter((l) => l.endsWith(`:${card.item.id}`)).length === 1);

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

test('a new line taught: read it, then the next; once the beat is read, its lines come back on their own, with the first letters', () => {
  const app = fakeApp();
  const s = start(app);
  const ids = app.model.beats[0].itemIds;
  s.advance();
  assert.equal(s.choose('teach').step, 'front');
  assert.ok(s.card.prompt);
  assert.equal(s.choose('next'), null, 'read: on to the next card, as after an answer');
  let c = s.advance();
  assert.deepEqual([c.item.id, c.step], [ids[1], 'test'], 'the next line: a go straight after reading is hardly a recall');
  assert.equal(app.getState(ids[0]).status, 'new', 'reading changes nothing');
  for (const id of ids.slice(1)) {
    assert.equal(s.card.item.id, id);
    s.choose('teach');
    s.choose('next');
    c = s.advance();
  }
  assert.deepEqual([c.queue, c.label, c.step], ['beat', 'Learning', 'help'], 'once the beat is read, a line of it with the first letters');
  assert.ok(ids.includes(c.item.id) && c.item.id !== ids.at(-1), 'not the line just read');
  assert.equal(c.message, SHUFFLE_MESSAGE, 'said once, the first time');
  const rec = answer(app, s, true);
  assert.equal(rec.event.help, true);
  assert.deepEqual([rec.state.status, rec.state.passes, rec.state.helped, rec.state.stability], ['learning', 0, 1, null], 'right with the first letters counts for nothing yet');
  assert.deepEqual([rec.need, rec.help, rec.later], ['clean', true, true], 'it comes back later from the cue alone');
  assert.deepEqual(s.stats, { answered: 0, perfect: 0, learnedItems: 0, learnedWords: 0 }, 'only goes from the cue alone are counted');
});

test('Try it: right, its next go is still with the first letters; missed, the line is read, then said from the first letters later', () => {
  const app = fakeApp();
  const s = start(app);
  const ids = app.model.beats[0].itemIds;
  const [first, second, third] = ids;
  s.advance();
  assert.equal(s.choose('try').step, 'floor');
  let rec = answer(app, s, true);
  assert.deepEqual([rec.need, rec.state.passes, rec.later], ['help', 1, true], 'right at the first try: the first letters next time all the same');
  let c = s.advance();
  assert.deepEqual([c.item.id, c.step], [second, 'test']);
  s.choose('try');
  rec = answer(app, s, false);
  assert.deepEqual([rec.need, rec.later], ['read', false], 'taught there and then, not later');
  c = s.advance();
  assert.deepEqual([c.item.id, c.step], [second, 'front']);
  assert.equal(s.choose('next'), null);
  assert.deepEqual([s.advance().item.id, s.card.step], [third, 'test'], 'then on through the beat');
  for (const id of ids.slice(2)) {
    assert.equal(s.card.item.id, id);
    s.choose('teach');
    s.choose('next');
    c = s.advance();
  }
  const log = play(app, s);
  assert.equal(log.find((l) => l.endsWith(`:${first}`)), `beat:help:${first}`);
  assert.equal(log.find((l) => l.endsWith(`:${second}`)), `beat:help:${second}`);
  assert.equal(app.events.find((e) => e.id === second && e.help).relearn, true, 'after a miss, the goes that follow relearn the line');
});

test('two misses in the first three tries switch the beat to teaching first', () => {
  const app = fakeApp();
  const s = start(app);
  const beat = app.model.beats[0];
  s.advance();
  s.choose('try');
  answer(app, s, false);
  s.advance();
  s.choose('next');
  let card = s.advance();
  assert.deepEqual([card.item.id, card.step], [beat.itemIds[1], 'test']);
  s.choose('try');
  answer(app, s, false);
  card = s.advance();
  assert.equal(card.step, 'front');
  assert.equal(card.message, TEACH_FIRST_MESSAGE);
  s.choose('next');
  card = s.advance();
  assert.deepEqual([card.item.id, card.step, card.message], [beat.itemIds[2], 'front', undefined]);
});

test('two beats at a time: a beat is read line by line, then each line comes back on its own and out of order, with the first letters, then twice without; the next beat once one is learned', () => {
  const app = fakeApp({ settings: { lastNewDay: '2026-10-26' } }); // everything is new today
  const log = play(app, start(app), { onTest: 'teach' });
  const [b1, b2, b3] = app.model.beats;
  assert.deepEqual(log.slice(0, 8), b1.itemIds.flatMap((id) => [`new:test:${id}`, `new:front:${id}`]), 'each line read in turn');
  const cards = log.filter((l) => !l.includes(':test:')); // a line tried or read is one card
  const at = (id, kind = '') => cards.map((l, i) => [l, i]).filter(([l]) => l.startsWith(kind) && l.endsWith(`:${id}`)).map(([, i]) => i);
  const gaps = [];
  for (const it of app.model.items) {
    assert.deepEqual(cards.filter((l) => l.endsWith(`:${it.id}`)).map((l) => l.split(':').slice(0, 2).join(':')), ['new:front', 'beat:help', 'beat:floor', 'beat:floor'], 'every line: read, then the first letters once and twice without');
    gaps.push(...at(it.id).slice(1).map((i, n) => i - at(it.id)[n] - 1));
    assert.equal(app.getState(it.id).status, 'review', 'and it is learned');
  }
  assert.ok(gaps.every((g) => g >= 1), 'never twice in a row');
  assert.ok(gaps.filter((g) => g < GAP).length * 20 <= gaps.length, `at least ${GAP} other cards in between, but for the odd one when nothing else is left: ${gaps}`);
  const goes = cards.filter((l) => l.startsWith('beat:')).map((l) => app.index.byId.get(l.split(':')[2]));
  const inOrder = goes.slice(1).filter((it, n) => it.scene === goes[n].scene && it.index === goes[n].index + 1).length;
  assert.equal(inOrder, 0, 'never the line after the one just said');
  const firstGoes = b1.itemIds.map((id) => at(id, 'beat:')[0]);
  assert.notDeepEqual(firstGoes, [...firstGoes].sort((a, b) => a - b), 'the first goes of a beat out of order too');
  const read = (b) => at(b.itemIds[0], 'new:')[0];
  assert.ok(Math.max(...firstGoes) < read(b2), 'beat 2 is read once every line of beat 1 has had a go');
  assert.ok(read(b2) < Math.max(...b1.itemIds.map((id) => at(id).at(-1))), 'and while beat 1 is still being learned: two at a time');
  assert.ok(Math.max(...b1.itemIds.map((id) => at(id).at(-1))) < read(b3), 'beat 3 waits until beat 1 is learned');
  assert.equal(POOL, 2);
  assert.ok(!log.some((l) => /^(due|run):/.test(l)), 'nothing learned comes back as a check within the hour');
  app.wait(90);
  const later = play(app, start(app, { scope: 'tests' }));
  assert.ok(later.some((l) => /^due:help:/.test(l) && l.endsWith(`:${b1.itemIds[0]}`)), 'an hour or so on, the first line learned comes back, with the first letters first');
});

test('a miss shows the right line and moves on; it comes back after three other answers with the first letters, then without', () => {
  const app = fakeApp();
  const [b0, b1, b3] = [0, 1, 3].map((i) => app.model.beats[i].itemIds);
  const ids = [b0[1], b1[0], b1[2], b3[0], b3[3]];
  ids.forEach((id, i) => learn(app, [id], { stability: 1, hoursAgo: 1.1 + 0.2 * i, ...SECURE })); // due, but still above 80%
  const s = start(app, { scope: 'tests' });
  const x = ids[4]; // the most at risk, so the first
  const cards = [];
  let card = s.advance();
  while (card) {
    cards.push(card);
    answer(app, s, !(card.item.id === x && cards.filter((c) => c.item.id === x).length === 1));
    card = s.advance();
  }
  const log = cards.map(where);
  assert.equal(log[0], `due:floor:${x}`);
  const xs = log.map((l, i) => [l, i]).filter(([l]) => l.endsWith(x));
  assert.deepEqual(xs.map(([l]) => l.split(':').slice(0, 2).join(':')), ['due:floor', 'again:help', 'again:floor']);
  assert.ok(xs[1][1] - xs[0][1] >= 4, 'at least three other answers before it comes back');
  assert.ok(xs[2][1] - xs[1][1] >= 2, 'and at least one more before the go without help');
  assert.equal(cards[xs[1][1]].message, AGAIN_MESSAGE, 'said once, the first time a line comes back');
  assert.equal(log.length, 7, 'every line once from the cue alone, the missed one twice more');
  assert.equal(app.getState(x).lastResult, 'pass', 'right again in the end');
  const evs = app.events.filter((e) => e.id === x);
  assert.deepEqual(evs.map((e) => [e.pass, !!e.help, !!e.relearn]), [[false, false, false], [true, true, true], [true, false, true]], 'the goes after the miss relearn it, so memory does not grow');
});

test('a go with the first letters missed comes back with the first letters again, then without', () => {
  const app = fakeApp();
  const [b0, b3] = [0, 3].map((i) => app.model.beats[i].itemIds);
  const ids = [b0[0], b0[2], b3[1], b3[4]];
  ids.forEach((id, i) => learn(app, [id], { stability: 1, hoursAgo: 2 + i })); // learned, not yet secure
  const x = ids[3];
  const log = play(app, start(app, { scope: 'tests' }), { decide: missFirst([x]) });
  assert.deepEqual(log.filter((l) => l.endsWith(x)), [`due:help:${x}`, `again:help:${x}`, `again:floor:${x}`]);
});

test('the forgetting curve decides the first go: due on time, from the cue alone, newer or secure; below 80% now, the first letters first', () => {
  const app = fakeApp();
  const newer = app.model.beats[1].itemIds[0];
  const secure = app.model.beats[3].itemIds[2];
  const slipping = app.model.beats[3].itemIds[4];
  learn(app, [newer], { stability: 1, hoursAgo: 1.5 }); // 86% now: due, and above 80%
  learn(app, [secure], { stability: 1, hoursAgo: 1.5, ...SECURE }); // the same for a secure line
  learn(app, [slipping], { stability: 1, hoursAgo: 3 }); // 77% now: below 80%
  const log = play(app, start(app, { scope: 'tests' }));
  assert.deepEqual(log.filter((l) => l.endsWith(newer)), [`due:floor:${newer}`]);
  assert.deepEqual(log.filter((l) => l.endsWith(secure)), [`due:floor:${secure}`]);
  assert.deepEqual(log.filter((l) => l.endsWith(slipping)), [`due:help:${slipping}`, `again:floor:${slipping}`]);
  const ev = app.events.filter((e) => e.id === slipping);
  assert.deepEqual(ev.map((e) => [!!e.help, !!e.primed]), [[true, false], [false, true]], 'the go after the first letters is marked, so the fit leaves it out');
  assert.ok(app.getState(slipping).stability > 1, 'right from the cue alone: its memory grows');
  assert.ok(app.getState(newer).stability > app.getState(slipping).stability, 'a check from the cue alone grows it more');
});

test('and the other way round: a newer line said minutes ago needs no help; a secure line left too long gets the first letters', () => {
  const app = fakeApp();
  const fresh = app.model.scenes[0].itemIds[0];
  const faded = app.model.scenes[3].itemIds[0];
  learn(app, [fresh], { stability: 2, hoursAgo: 0.3 }); // 98% now
  learn(app, [faded], { stability: 1, hoursAgo: 4, ...SECURE }); // 72% now
  const log = play(app, start(app, { custom: { itemIds: [fresh, faded] } }));
  assert.deepEqual(log, [`due:floor:${fresh}`, `due:help:${faded}`, `again:floor:${fresh}`, `again:floor:${faded}`], 'a line already right comes in between');
});

test('checks of newer lines due together: each on its own and out of order, the first letters first, then without; only those goes count', () => {
  const app = fakeApp();
  const ids = app.model.scenes[3].itemIds;
  learn(app, ids, { stability: 1, hoursAgo: 3 });
  const s = start(app, { scope: 'tests' });
  const log = play(app, s);
  const helps = log.filter((l) => l.startsWith('due:help:'));
  assert.deepEqual([...helps].sort(), ids.map((id) => `due:help:${id}`).sort(), 'each line checked, with the first letters first');
  assert.notDeepEqual(helps, ids.map((id) => `due:help:${id}`), 'not in the order of the script');
  for (const id of ids) assert.deepEqual(log.filter((l) => l.endsWith(`:${id}`)), [`due:help:${id}`, `again:floor:${id}`]);
  assert.deepEqual([s.stats.answered, s.stats.perfect], [6, 6]);
});

// Today is a final day: every learned line every day, whole scenes from the top.
const FINAL = { lastNewDay: '2026-10-24', deadline: '2026-10-28' };

test('in the final days a scene is run whole from the top; a line missed flows on, and comes back later with the first letters', () => {
  const app = fakeApp({ settings: FINAL });
  const ids = app.model.scenes[3].itemIds;
  learn(app, ids, { stability: 1, hoursAgo: 1.5, ...SECURE });
  const log = play(app, start(app, { scope: 'tests' }), { decide: missFirst([ids[1]]) });
  assert.deepEqual(log.slice(0, 6), ids.map((id) => `run:floor:${id}`), 'the run carried on after the miss');
  assert.deepEqual(log.slice(6), [`again:help:${ids[1]}`, `again:floor:${ids[0]}`, `again:floor:${ids[1]}`], 'first letters, a line already right in between, then without');
});

test('older lines are checked in between: one after every three goes on lines coming back, the most at risk first', () => {
  const app = fakeApp();
  const [b0, b1, b3] = [0, 1, 3].map((i) => app.model.beats[i].itemIds);
  const firstDay = '2026-10-20'; // started on an earlier day, so today's new lines are still to come
  learn(app, [...b0, ...b1, ...b3], { stability: 48, hoursAgo: 1, firstDay });
  const ready = [b0[1], b1[0], b1[2], b1[3], b3[0], b3[2], b3[4]];
  // Later in the list: more at risk, each at least 5 points more (88%, 83% and on down to 58%).
  [1.3, 2, 2.85, 3.85, 5.1, 6.65, 8.65].forEach((hoursAgo, i) => learn(app, [ready[i]], { stability: 1, hoursAgo, firstDay }));
  const log = play(app, start(app), { max: 400 });
  const firstGo = log.findIndex((l) => !l.startsWith('new:'));
  assert.ok(firstGo > 0 && log[firstGo].startsWith('beat:'), 'the new beat is taught first');
  assert.deepEqual(log.filter((l) => l.startsWith('due:')).map((l) => l.split(':')[2]), [...ready].reverse(), 'the most at risk first');
  const lastCheck = log.findLastIndex((l) => l.startsWith('due:'));
  let run = 0;
  for (const l of log.slice(firstGo, lastCheck)) {
    run = l.startsWith('due:') ? 0 : run + 1;
    assert.ok(run <= CHECK_EVERY, `no more than ${CHECK_EVERY} goes in a row on lines coming back while a check is waiting`);
  }
  for (const id of ready) assert.equal(app.getState(id).lastResult, 'pass');
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
  b0.forEach((id, i) => assert.ok(app.getState(id).stability > 1.5 * before[i], 'after that check they last longer'));
  assert.ok(app.events.filter((e) => e.id === b0[1] && !e.help).length >= 3, 'recalled from the cue alone at least three times on its first day');
});

test('time up: nothing new comes; what the sprint has shown is finished, then it is over', () => {
  const app = fakeApp();
  const s = start(app);
  const [first, second] = app.model.beats[0].itemIds;
  s.advance();
  s.choose('teach');
  s.choose('next'); // read: it still needs the first letters, then a go without
  s.close();
  assert.equal(s.closing, true);
  const c = s.advance();
  assert.deepEqual([where(c), c.label, c.message], [`beat:help:${first}`, 'Learning', CLOSING_MESSAGE], 'nothing else to put in between, so it comes now');
  answer(app, s, true);
  assert.equal(where(s.advance()), `beat:floor:${first}`);
  answer(app, s, true);
  assert.equal(s.advance(), null, 'right from the cue alone once is enough at time up');
  s.finish();
  const again = start(app, { saved: s.save() });
  assert.equal(again.closing, false);
  const next = again.advance();
  assert.deepEqual([next.item.id, next.step], [second, 'test'], 'the next sprint starts afresh');
  again.choose('teach');
  again.choose('next');
  again.close();
  assert.equal(where(again.advance()), `beat:help:${second}`);
  answer(app, again, true);
  assert.equal(where(again.advance()), `beat:floor:${second}`);
  answer(app, again, true);
  assert.equal(again.advance(), null, 'the first line, not shown in this sprint, waits');
});

test('time up in a run: the run stops; lines it showed come back on their own, the rest wait', () => {
  const app = fakeApp({ settings: FINAL });
  const ids = app.model.scenes[3].itemIds;
  learn(app, ids, { stability: 1, hoursAgo: 3 });
  const log = play(app, start(app, { scope: 'tests' }), { close: (l) => l.length === 2 });
  assert.deepEqual(log, [`run:help:${ids[0]}`, `run:help:${ids[1]}`, `again:floor:${ids[0]}`, `again:floor:${ids[1]}`]);
});

test('a sprint picked up hours later: lines right earlier come back when the curve says so, with a fresh first go', () => {
  const app = fakeApp();
  const ids = app.model.scenes[3].itemIds;
  learn(app, ids, { stability: 1, hoursAgo: 3 });
  const s = start(app, { scope: 'tests' });
  play(app, s);
  assert.equal(s.advance(), null, 'all done for now');
  app.wait(12 * 60);
  const again = start(app, { scope: 'tests', saved: s.save() });
  const log = play(app, again);
  for (const id of ids) assert.equal(log.find((l) => l.endsWith(`:${id}`)), `due:help:${id}`, 'due again, and below 80% now, so the first letters first');
});

test('undo restores the card, the item state and what the sprint owes', () => {
  const app = fakeApp();
  const s = start(app);
  s.advance();
  s.choose('try');
  const before = app.getState(s.card.item.id);
  const rec = answer(app, s, false);
  s.advance();
  app.undo();
  const card = s.restore(rec.snapshot);
  assert.equal(card.step, 'floor');
  assert.deepEqual(app.getState(card.item.id), before);
  assert.equal(app.events.length, 0);
  assert.equal(s.state.lines[card.item.id], undefined, 'and the sprint has no record of the answer');
});

test('a saved sprint carries on where it stopped; one saved by the first version starts afresh', () => {
  const app = fakeApp();
  const s = start(app);
  s.advance();
  s.choose('teach');
  const again = start(app, { saved: s.save() });
  assert.equal(again.card.step, 'front');
  assert.equal(again.card.item.id, s.card.item.id);
  const old = { ...s.save(), v: undefined, task: { kind: 'item', queue: 'new', id: s.card.item.id, step: 'back', ladderMisses: 0 } };
  const fresh = start(app, { saved: old });
  assert.equal(fresh.card, null);
  assert.equal(fresh.advance().step, 'test');
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

test('Run this scene: one run over its lines, misses flow on and come back later, each on its own and out of order', () => {
  const app = fakeApp();
  const ids = app.model.scenes[1].itemIds;
  learn(app, ids, { stability: 1, hoursAgo: 3 });
  const log = play(app, start(app, { custom: { scene: 1, itemIds: ids } }), { decide: missFirst(ids) });
  assert.deepEqual(log.slice(0, ids.length), ids.map((id) => `run:help:${id}`), 'newer lines: a first letters run');
  const back = log.slice(ids.length);
  for (const id of ids) assert.deepEqual(back.filter((l) => l.endsWith(`:${id}`)), [`again:help:${id}`, `again:floor:${id}`], 'every miss back with the first letters, then without');
  const helps = back.filter((l) => l.startsWith('again:help:'));
  assert.notDeepEqual(helps, ids.map((id) => `again:help:${id}`), 'out of order');
});

test('Try a run of a scene not yet learned: from the cue alone; right, a line comes back with the first letters, then without; missed, to read first', () => {
  const app = fakeApp();
  const ids = app.model.scenes[3].itemIds;
  const log = play(app, start(app, { custom: { scene: 3, itemIds: ids } }), { decide: missFirst([ids[2]]) });
  assert.deepEqual(log.slice(0, 6), ids.map((id) => `run:floor:${id}`));
  const goes = (id) => log.filter((l) => l.endsWith(`:${id}`)).map((l) => l.split(':').slice(0, 2).join(':'));
  assert.deepEqual(goes(ids[2]), ['run:floor', 'again:front', 'again:help', 'again:help', 'again:floor']);
  for (const id of ids.filter((x) => x !== ids[2])) assert.deepEqual(goes(id), ['run:floor', 'again:help', 'again:floor']);
  const [, second] = app.events.filter((e) => e.id === ids[5]);
  assert.equal(second.prev.stability, 4, 'right before being taught: known');
});

test('chosen practice: lines from several scenes, as runs where they follow on, with the help he chooses', () => {
  const app = fakeApp();
  const sc0 = app.model.scenes[0].itemIds;
  const sc3 = app.model.scenes[3].itemIds;
  learn(app, [...sc0, ...sc3], { stability: 1, hoursAgo: 3, ...SECURE });
  const itemIds = [...sc0, sc3[0], sc3[1], sc3[4]];
  const none = play(app, start(app, { custom: { itemIds, help: 'none' } }), { decide: missFirst([sc0[1]]) });
  assert.deepEqual(none, [...sc0.map((id) => `run:floor:${id}`), `run:floor:${sc3[0]}`, `run:floor:${sc3[1]}`, `again:floor:${sc0[1]}`, `due:floor:${sc3[4]}`], 'no help: every go from the cue alone, a miss too, back in between');
  const letters = play(app, start(app, { custom: { itemIds: [sc3[4]], help: 'letters' } }));
  assert.deepEqual(letters, [`due:help:${sc3[4]}`, `again:floor:${sc3[4]}`], 'first letters first, even for a secure line');
  const read = play(app, start(app, { custom: { itemIds: [sc3[4]], help: 'read' } }));
  assert.deepEqual(read, [`due:front:${sc3[4]}`, `due:help:${sc3[4]}`, `again:floor:${sc3[4]}`], 'read it, first letters, then without');
});

test('a chosen practice saved part way says how many lines it still has to go', () => {
  const app = fakeApp();
  const ids = app.model.scenes[3].itemIds;
  learn(app, ids, { stability: 1, hoursAgo: 1.5, ...SECURE });
  const s = start(app, { custom: { itemIds: ids, help: 'none' } });
  assert.equal(linesLeft(s.save()), 6);
  s.advance(); // one run over all six
  answer(app, s, false);
  assert.equal(linesLeft(s.save()), 6, 'five still to come in the run, and the one missed');
  for (let i = 0; i < 5; i++) {
    s.advance();
    answer(app, s, true);
  }
  assert.equal(linesLeft(s.save()), 1, 'just the one missed');
  assert.equal(linesLeft(start(app).save()), 0, 'not a chosen practice');
});

test('time up in a chosen practice keeps the lines it had not reached, so it can carry on with them', () => {
  const app = fakeApp();
  const ids = app.model.scenes[3].itemIds;
  learn(app, ids, { stability: 48, hoursAgo: 1, ...SECURE });
  const s = start(app, { custom: { itemIds: ids, help: 'none', title: 'Scene 3, every line' } });
  s.advance(); // one run over all six
  answer(app, s, true);
  s.close();
  assert.equal(s.advance(), null, 'the run stops at time up');
  s.finish();
  assert.equal(linesLeft(s.save()), 5);
  const later = start(app, { saved: s.save() });
  const c = later.advance();
  assert.deepEqual([c.item.id, c.progress.total], [ids[1], 5], 'carrying on: a run of the five not reached');
});

test('a cue that leads to more than one line is shown longer on its card', () => {
  const app = fakeApp();
  const [lead, id] = app.model.beats[1].itemIds.slice(0, 2);
  const long = { ...app.index.byId.get(id).cue, lead: [lead], lines: [{ speaker: 'Someone', text: 'A line before.' }] };
  app.index.cues.set(id, long);
  learn(app, [id], { stability: 1, hoursAgo: 1.5 });
  const card = start(app, { scope: 'tests' }).advance();
  assert.equal(where(card), `due:floor:${id}`);
  assert.equal(card.cue, long);
});

test('an answer saves which words were missed and how long it took, for trouble words later', () => {
  const app = fakeApp();
  const s = start(app);
  s.advance();
  s.choose('try');
  const missed = s.answer(makeResult({ misses: [0, 2], mode: 'type', ms: 4200, firstMs: 900 }));
  assert.deepEqual(missed.event.missed, [0, 2]);
  assert.equal(missed.event.misses, 2);
  assert.equal(missed.event.ms, 4200);
  assert.equal(missed.event.firstMs, 900);
  app.save(missed);
  let c = s.advance();
  while (c && c.step !== 'floor' && c.step !== 'help') c = c.step === 'test' ? s.choose('try') : s.choose('next');
  const right = s.answer(makeResult({ misses: [], mode: 'say' }));
  assert.equal('missed' in right.event, false);
  assert.equal('ms' in right.event, false);
});

test('a slip of the finger counted right is saved as right, and marked as a slip', () => {
  const app = fakeApp();
  const s = start(app);
  s.advance();
  s.choose('try');
  const rec = s.answer(makeResult({ misses: [], mode: 'type', slip: true }));
  assert.equal(rec.event.pass, true);
  assert.equal(rec.event.slip, true);
});

test('right but typed much slower than usual once under way: its memory grows by half as much; a slow start alone is not slow', () => {
  const app = fakeApp();
  const ids = app.model.beats[3].itemIds.filter((id) => app.index.byId.get(id).words >= 3).slice(0, 3);
  assert.equal(ids.length, 3);
  const [slowId, startId, quickId] = ids;
  learn(app, ids, { stability: 1, hoursAgo: 1.5 }); // due, and above 80%: from the cue alone
  // His usual: 20 earlier lines typed right at half a second a word after the first key.
  for (let i = 0; i < 20; i++) app.events.push({ id: quickId, mode: 'type', pass: true, firstMs: 2000, ms: 2000 + 500 * (app.index.byId.get(quickId).words - 1) });
  const s = start(app, { scope: 'tests' });
  const recs = new Map();
  for (let c = s.advance(); c; c = s.advance()) {
    const after = c.item.words - 1;
    const timing = { [slowId]: { firstMs: 2000, ms: 2000 + 1100 * after }, [startId]: { firstMs: 30000, ms: 30000 + 500 * after }, [quickId]: { firstMs: 2000, ms: 2000 + 500 * after } }[c.item.id];
    const rec = s.answer(makeResult({ misses: [], mode: 'type', ...timing }));
    app.save(rec);
    recs.set(c.item.id, rec);
  }
  assert.deepEqual([...recs.keys()].sort(), [...ids].sort(), 'one go each');
  assert.equal(recs.get(slowId).event.slow, true, 'more than twice as long a word');
  assert.equal('slow' in recs.get(startId).event, false, 'long to start (reading the cue, say), then typed at his usual speed');
  assert.equal('slow' in recs.get(quickId).event, false);
  const grew = (id) => recs.get(id).state.stability;
  // (The answers come 10 seconds apart, so their growth differs a touch anyway.)
  assert.ok(Math.abs(grew(slowId) - 1 - (grew(quickId) - 1) / 2) < 0.01, `slow: x${grew(slowId).toFixed(3)}, usual: x${grew(quickId).toFixed(3)}`);
  assert.ok(grew(slowId) > 1, 'it still grows: it was right');
});

test('a line being read: only Next moves on, so a second tap on Teach me does not skip the reading', () => {
  const app = fakeApp();
  const s = start(app);
  assert.equal(s.advance().step, 'test');
  const front = s.choose('teach');
  assert.equal(front.step, 'front');
  assert.equal(s.choose('teach'), front, 'the same card, still on show');
  assert.equal(s.choose('try'), front);
  assert.equal(s.state.lines[front.item.id]?.taught, undefined, 'not yet read');
  assert.equal(s.choose('next'), null, 'read: on to the next card');
  assert.equal(s.state.lines[front.item.id].taught, true);
});

test('a line read with its beat, then missed with the first letters, has the first letters twice more before it goes without', () => {
  const app = fakeApp();
  const target = app.model.beats[0].itemIds[0];
  let missed = false;
  const log = play(app, start(app), {
    onTest: 'teach',
    decide: (card) => {
      if (card.item.id === target && card.step === 'help' && !missed) return !(missed = true);
      return true;
    },
  });
  const goes = log.filter((l) => l.endsWith(`:${target}`)).map((l) => l.split(':')[1]);
  const after = goes.slice(goes.indexOf('help') + 1);
  assert.deepEqual(after.slice(0, after.indexOf('floor')), ['front', 'help', 'help'], `read again, then the first letters twice: ${goes.join(' ')}`);
  assert.equal(app.getState(target).status, 'review', 'and it is learned');
});

// The first card of a chosen practice of one line, with the line in the given state (as learn() sets it).
function firstCard(id, state, custom = {}) {
  const app = fakeApp();
  learn(app, [id], state);
  return start(app, { custom: { itemIds: [id], ...custom } }).advance();
}

const ONCE = { status: 'learning', learnedDay: null, passes: 1, stability: 1, hoursAgo: 0.5 }; // right from the cue alone once

test('first letters thin out as a long line gets stronger: every one, then the start of each phrase, then the words missed before', () => {
  const { model } = fakeApp();
  const long = model.items.find((it) => it.words >= LONG);
  const short = model.items.find((it) => it.words < LONG && it.words >= 3);
  const cases = [
    [long, { status: 'learning', learnedDay: null, passes: 0, helped: 1, stability: null, lastResult: null }, 'all', 'said from the first letters, never yet right from the cue alone'],
    [long, ONCE, 'phrases', 'right from the cue alone once'],
    [long, { passes: 2, stability: 1, hoursAgo: 0.5 }, 'missed', 'right twice'],
    [long, { stability: 1, hoursAgo: 3 }, 'phrases', 'right three times, but slipping at a check (77% now)'],
    [long, { lastResult: 'miss', stability: 0.5, hoursAgo: 1 }, 'all', 'missed last time'],
    [short, ONCE, 'all', 'a line under 8 words'],
  ];
  for (const [it, state, letters, why] of cases) {
    const c = firstCard(it.id, state);
    assert.deepEqual([c.step, c.letters], ['help', letters], why);
  }
  assert.equal(firstCard(long.id, ONCE, { help: 'letters' }).letters, 'all', 'chosen practice with the first letters first: every one');
  assert.equal(firstCard(long.id, { passes: 3, stability: 1, hoursAgo: 0.5 }).step, 'floor', 'right three times and not slipping: from the cue alone, as before');
});

test('a long line missed with fewer first letters has every one when it comes back', () => {
  const app = fakeApp();
  const long = app.model.items.find((it) => it.words >= LONG);
  learn(app, [long.id], { passes: 2, stability: 1, hoursAgo: 0.5 });
  const s = start(app, { custom: { itemIds: [long.id] } });
  const seen = [];
  let card = s.advance();
  while (card) {
    seen.push(`${card.step}:${card.letters ?? ''}`);
    answer(app, s, seen.length > 1);
    card = s.advance();
  }
  assert.deepEqual(seen, ['help:missed', 'help:all', 'floor:']);
});

test('the first card of the day with fewer first letters says why, once', () => {
  const app = fakeApp();
  const longs = app.model.items.filter((it) => it.words >= LONG).slice(0, 2).map((it) => it.id);
  learn(app, longs, ONCE);
  const s = start(app, { custom: { itemIds: longs } });
  const said = [];
  let card = s.advance();
  while (card) {
    if (card.step === 'help') said.push(card.message);
    answer(app, s, true);
    card = s.advance();
  }
  assert.deepEqual(said, [LETTERS_MESSAGE, undefined]);
});

// Plays a sprint as play() does, keeping each card's message.
function playSaid(app, s, opts) {
  const said = [];
  let card = s.advance();
  const log = [];
  while (card && log.length < 500) {
    log.push(where(card));
    said.push(card.message);
    if (card.step === 'test') card = s.choose(opts.onTest);
    else if (card.step === 'front') card = s.choose('next') || s.advance();
    else {
      answer(app, s, opts.decide(card));
      card = s.advance();
    }
  }
  return { log, said };
}

test('a line missed from its cue keeps its beat being learned, and never more than two beats are; the way lines come back is said once', () => {
  const app = fakeApp({ settings: { lastNewDay: '2026-10-26' } }); // everything is new today
  const x = app.model.beats[0].itemIds[1];
  let missed = false;
  const decide = (card) => {
    if (card.item.id === x && card.step === 'floor' && !missed) return !(missed = true); // its first go from the cue alone is missed
    return true;
  };
  const { log, said } = playSaid(app, start(app), { onTest: 'teach', decide });
  const goes = log.map((l, i) => [l, i]).filter(([l]) => l.endsWith(`:${x}`));
  assert.deepEqual(goes.map(([l]) => l.split(':').slice(0, 2).join(':')), ['new:test', 'new:front', 'beat:help', 'beat:floor', 'beat:help', 'beat:floor', 'beat:floor'], 'missed: the first letters again, then twice without');
  // A beat is being learned from its first line read to its last go.
  const spans = app.model.beats.map((b) => {
    const at = log.map((l, i) => [l, i]).filter(([l]) => b.itemIds.some((id) => l.endsWith(`:${id}`))).map(([, i]) => i);
    return [at[0], at.at(-1)];
  });
  assert.ok(spans[0][1] > spans[1][1], 'the first beat is learned after the second, held back by the line missed');
  log.forEach((l, i) => assert.ok(spans.filter(([a, z]) => a <= i && i <= z).length <= POOL, `no more than ${POOL} beats at once`));
  assert.equal(said.filter((m) => m === SHUFFLE_MESSAGE).length, 1, 'said once');
  for (const it of app.model.items) assert.equal(app.getState(it.id).status, 'review', 'every line learned');
});

test('a beat under way is finished while its own lines are in flight', () => {
  const app = fakeApp({ settings: { lastNewDay: '2026-10-26' } }); // everything is new today
  const [b1, b2] = app.model.beats;
  learn(app, b1.itemIds.slice(0, 2), { status: 'learning', learnedDay: null, passes: 0, helped: 1, stability: null, lastResult: null, hoursAgo: 2 });
  const log = play(app, start(app), { onTest: 'teach' });
  assert.equal(log[0], `new:test:${b1.itemIds[2]}`, 'its lines still to be taught come first');
  assert.ok(log.indexOf(`new:test:${b2.itemIds[0]}`) > log.lastIndexOf(`new:front:${b1.itemIds[3]}`));
});

test('two beats part learned, each with a line in flight (as a chosen practice can leave them): new lines still come', () => {
  const app = fakeApp({ settings: { lastNewDay: '2026-10-26' } }); // everything is new today
  const [b1, b2] = app.model.beats;
  learn(app, [b1.itemIds[0], b2.itemIds[0]], { status: 'learning', learnedDay: null, passes: 0, helped: 1, stability: null, lastResult: null, hoursAgo: 2 });
  const log = play(app, start(app), { onTest: 'teach' });
  assert.equal(log[0], `new:test:${b1.itemIds[1]}`, 'the first beat part learned is finished first');
  assert.ok(log.indexOf(`new:test:${b2.itemIds[1]}`) > log.indexOf(`new:test:${b1.itemIds[1]}`), 'then the second');
  for (const it of app.model.items) assert.equal(app.getState(it.id).status, 'review', 'every line learned');
});
