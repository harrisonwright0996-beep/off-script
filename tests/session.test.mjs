import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeApp, learn } from './helpers.mjs';
import { createSession, linesLeft, TEACH_FIRST_MESSAGE, AHEAD_MESSAGE, EXTRA_RUN_MESSAGE, AGAIN_MESSAGE, CLOSING_MESSAGE } from '../src/session.js';
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
    else if (card.step === 'front') card = s.choose('next');
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

test('a new line taught: read it, say it from the first letters, then on to the next line', () => {
  const app = fakeApp();
  const s = start(app);
  const [, second] = app.model.beats[0].itemIds;
  s.advance();
  assert.equal(s.choose('teach').step, 'front');
  assert.ok(s.card.prompt);
  assert.equal(s.choose('next').step, 'help');
  const rec = answer(app, s, true);
  assert.equal(rec.event.help, true);
  assert.deepEqual([rec.state.status, rec.state.passes, rec.state.helped, rec.state.stability], ['learning', 0, 1, null], 'right with the first letters counts for nothing yet');
  assert.deepEqual([rec.need, rec.help, rec.later], ['help', true, true], 'it comes back later with the first letters once more, then without');
  const c = s.advance();
  assert.deepEqual([c.item.id, c.step], [second, 'test']);
  assert.deepEqual(s.stats, { answered: 0, perfect: 0, learnedItems: 0, learnedWords: 0 }, 'only goes from the cue alone are counted');
});

test('Try it: right, its next go is still with the first letters; missed, the line is read, then said from the first letters', () => {
  const app = fakeApp();
  const s = start(app);
  const [, second, third] = app.model.beats[0].itemIds;
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
  assert.equal(s.choose('next').step, 'help');
  rec = answer(app, s, true);
  assert.equal(rec.event.relearn, true, 'after a miss, the goes that follow relearn the line');
  assert.equal(s.advance().item.id, third);
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
  answer(app, s, true);
  let card = s.advance();
  assert.deepEqual([card.item.id, card.step], [beat.itemIds[1], 'test']);
  s.choose('try');
  answer(app, s, false);
  card = s.advance();
  assert.equal(card.step, 'front');
  assert.equal(card.message, TEACH_FIRST_MESSAGE);
  s.choose('next');
  answer(app, s, true);
  card = s.advance();
  assert.deepEqual([card.item.id, card.step, card.message], [beat.itemIds[2], 'front', undefined]);
});

test('a beat is taught line by line, then run three times, first with the first letters, other beats taught in between, and its lines are learned', () => {
  const app = fakeApp({ settings: { lastNewDay: '2026-10-26' } }); // everything is new today
  const log = play(app, start(app), { onTest: 'teach' });
  const [b1, b2] = app.model.beats;
  const first = (b) => b.itemIds[0];
  assert.deepEqual(log.slice(0, 12), b1.itemIds.flatMap((id) => [`new:test:${id}`, `new:front:${id}`, `new:help:${id}`]));
  assert.deepEqual(log.slice(12, 16), b1.itemIds.map((id) => `beat:help:${id}`), 'the first beat run is with the first letters again');
  const runs = (b) => log.map((l, i) => [l, i]).filter(([l]) => l.startsWith('beat:') && l.endsWith(`:${first(b)}`));
  assert.deepEqual(runs(b1).map(([l]) => l.split(':')[1]), ['help', 'floor', 'floor'], 'then twice from the cue alone');
  const b2At = log.indexOf(`new:test:${first(b2)}`);
  assert.ok(runs(b1)[0][1] < b2At && b2At < runs(b1)[1][1], 'the second run of beat 1 comes after teaching beat 2');
  for (const id of b1.itemIds) assert.equal(app.getState(id).status, 'review');
  const kinds = (id) => log.filter((l) => l.endsWith(`:${id}`) && /^(new|beat):/.test(l)).map((l) => l.split(':').slice(0, 2).join(':'));
  for (const it of app.model.items) assert.deepEqual(kinds(it.id), ['new:test', 'new:front', 'new:help', 'beat:help', 'beat:floor', 'beat:floor'], 'every line: test, read, first letters, then a run with them and two without');
  assert.ok(!log.some((l) => /^(due|run):/.test(l)), 'nothing learned comes back as a check within the hour');
  app.wait(90);
  const later = play(app, start(app, { scope: 'tests' }));
  assert.ok(later.some((l) => /^(due|run):help:/.test(l) && l.endsWith(`:${first(b1)}`)), 'an hour or so on, the first line learned comes back, with the first letters first');
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

test('a run of newer lines is a first letters run, then comes back as a run without help; only those goes count', () => {
  const app = fakeApp();
  const ids = app.model.scenes[3].itemIds;
  learn(app, ids, { stability: 1, hoursAgo: 3 });
  const s = start(app, { scope: 'tests' });
  const log = play(app, s);
  assert.deepEqual(log, [...ids.map((id) => `run:help:${id}`), ...ids.map((id) => `run:floor:${id}`)]);
  assert.deepEqual([s.stats.answered, s.stats.perfect], [6, 6]);
});

test('a line missed in a run: the run flows on, and the line comes back later with the first letters', () => {
  const app = fakeApp();
  const ids = app.model.scenes[3].itemIds;
  learn(app, ids, { stability: 1, hoursAgo: 1.5, ...SECURE });
  const log = play(app, start(app, { scope: 'tests' }), { decide: missFirst([ids[1]]) });
  assert.deepEqual(log.slice(0, 6), ids.map((id) => `run:floor:${id}`), 'the run carried on after the miss');
  assert.deepEqual(log.slice(6), [`again:help:${ids[1]}`, `again:floor:${ids[0]}`, `again:floor:${ids[1]}`], 'first letters, a line already right in between, then without');
});

test('older lines are checked in between new beats: six at a time, the most at risk first', () => {
  const app = fakeApp();
  const [b0, b1, b3] = [0, 1, 3].map((i) => app.model.beats[i].itemIds);
  const firstDay = '2026-10-20'; // started on an earlier day, so today's new lines are still to come
  learn(app, [...b0, ...b1, ...b3], { stability: 48, hoursAgo: 1, firstDay });
  const ready = [b0[1], b1[0], b1[2], b1[3], b3[0], b3[2], b3[4]];
  ready.forEach((id, i) => learn(app, [id], { stability: 1, hoursAgo: 2 + i, firstDay })); // later in the list: more at risk
  const log = play(app, start(app), { max: 400 });
  const firstNew = log.findIndex((l) => l.startsWith('new:'));
  const before = log.slice(0, firstNew);
  assert.deepEqual(before.filter((l) => l.startsWith('due:')), [...ready].reverse().slice(0, 6).map((id) => `due:help:${id}`));
  assert.ok(before.some((l) => l.startsWith('again:floor:')), 'the first ones come back without help in between');
  const seventh = log.indexOf(`due:floor:${ready[0]}`); // 82% now: from the cue alone
  assert.ok(seventh > firstNew && log.slice(firstNew, seventh).some((l) => l.startsWith('beat:')), 'the seventh waits until the new beat has had its run');
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
  s.choose('next');
  answer(app, s, true); // taught: it still needs the first letters once more, then a go without
  s.close();
  assert.equal(s.closing, true);
  const c = s.advance();
  assert.deepEqual([where(c), c.message], [`again:help:${first}`, CLOSING_MESSAGE], 'nothing else to put in between, so it comes now');
  answer(app, s, true);
  assert.equal(where(s.advance()), `again:floor:${first}`);
  answer(app, s, true);
  assert.equal(s.advance(), null);
  s.finish();
  const again = start(app, { saved: s.save() });
  assert.equal(again.closing, false);
  const next = again.advance();
  assert.deepEqual([next.item.id, next.step], [second, 'test'], 'the next sprint starts afresh');
});

test('time up in a run: the run stops; lines it showed come back on their own, the rest wait', () => {
  const app = fakeApp();
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
  assert.deepEqual(log.slice(0, 6), ids.map((id) => `run:help:${id}`), 'due again, and below 80% now, so the first letters first');
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
  s.choose('next');
  const again = start(app, { saved: s.save() });
  assert.equal(again.card.step, 'help');
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

test('Run this scene: one run over its lines, misses flow on and come back later', () => {
  const app = fakeApp();
  const ids = app.model.scenes[1].itemIds;
  learn(app, ids, { stability: 1, hoursAgo: 3 });
  const log = play(app, start(app, { custom: { scene: 1, itemIds: ids } }), { decide: missFirst(ids) });
  assert.deepEqual(log.slice(0, ids.length), ids.map((id) => `run:help:${id}`), 'newer lines: a first letters run');
  assert.deepEqual(log.slice(ids.length), [...ids.map((id) => `run:help:${id}`), ...ids.map((id) => `run:floor:${id}`)], 'every miss back as a run, then without help');
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
