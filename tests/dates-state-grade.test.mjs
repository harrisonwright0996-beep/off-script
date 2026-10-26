import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, addDays, daysBetween, weekday, formatDay, dayEnd } from '../src/dates.js';
import { newState, applyResult, applyHelp, needsTeaching, category, isSecure, isWordPerfect } from '../src/state.js';
import { createTypeCheck, sayMisses, makeResult, describeResult } from '../src/grade.js';
import { tokenize } from '../src/tokens.js';

test('the day starts at 03:00 local time', () => {
  assert.equal(dayKey(new Date('2026-10-27T02:59:00')), '2026-10-26');
  assert.equal(dayKey(new Date('2026-10-27T03:00:00')), '2026-10-27');
  assert.equal(dayKey(new Date('2026-11-01T00:30:00')), '2026-10-31');
});

test('a day ends at 03:00 the next morning, local time', () => {
  assert.equal(dayEnd('2026-10-31'), new Date('2026-11-01T03:00:00').getTime());
});

test('day arithmetic crosses months and the clocks going back', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(daysBetween('2026-10-26', '2026-11-04'), 9);
  assert.equal(daysBetween('2026-11-04', '2026-10-26'), -9);
  assert.equal(weekday('2026-11-04'), 'Wednesday');
  assert.equal(formatDay('2026-11-01'), 'Sun 1 Nov');
  assert.equal(formatDay('2026-12-14', { long: true }), 'Monday 14 December');
});

test('two passes reach review; misses never undo passes', () => {
  let s = newState('x');
  s = applyResult(s, { pass: false, day: 'd1', time: 1, mode: 'type', queue: 'new' });
  assert.equal(s.status, 'learning');
  assert.equal(s.firstDay, 'd1');
  s = applyResult(s, { pass: true, day: 'd1', time: 2, mode: 'type', queue: 'beat' });
  assert.equal(s.status, 'learning');
  s = applyResult(s, { pass: true, day: 'd1', time: 3, mode: 'type', queue: 'beat' });
  assert.equal(s.status, 'review');
  assert.equal(s.learnedDay, 'd1');
  assert.deepEqual([s.passes, s.misses], [2, 1]);
  assert.equal(category(s), 'perfect');
  s = applyResult(s, { pass: false, day: 'd2', time: 5, mode: 'say', queue: 'run' });
  assert.equal(category(s), 'missed');
  assert.deepEqual(s.missDays, ['d1', 'd2']);
});

test('interrupted first sessions: review comes at the second pass, whatever the day', () => {
  let s = newState('x');
  s = applyResult(s, { pass: true, day: '2026-10-26', time: 1, mode: 'type', queue: 'beat' });
  s = applyResult(s, { pass: true, day: '2026-10-27', time: 2, mode: 'type', queue: 'beat' });
  assert.equal(s.status, 'review');
  assert.equal(s.learnedDay, '2026-10-27');
});

test('a go with the first letters right changes nothing but marks a new line as started', () => {
  let s = applyHelp(newState('x'), { day: '2026-10-26' });
  assert.deepEqual([s.status, s.firstDay, s.helped, s.passes, s.stability, s.lastResult, s.lastTime], ['learning', '2026-10-26', 1, 0, null, null, 0]);
  assert.deepEqual(s.passDays, []);
  const learned = { ...newState('y'), status: 'review', firstDay: 'd1', learnedDay: 'd1', passes: 2, stability: 24, passDays: ['d1'], lastResult: 'miss', lastDay: 'd1', lastTime: 5 };
  s = applyHelp(learned, { day: 'd2' });
  assert.deepEqual(s, { ...learned, helped: 1 }, 'a learned line keeps its memory, its last result and its days');
});

test('still to be taught: never right, with or without the first letters', () => {
  assert.equal(needsTeaching(newState('x')), true);
  const missed = applyResult(newState('x'), { pass: false, day: 'd', time: 1, mode: 'say' });
  assert.equal(needsTeaching(missed), true);
  assert.equal(needsTeaching(applyHelp(missed, { day: 'd' })), false);
  assert.equal(needsTeaching(applyResult(newState('x'), { pass: true, day: 'd', time: 1, mode: 'say' })), false);
  assert.equal(needsTeaching({ ...newState('x'), status: 'learning', passes: 0 }), true, 'a state saved before first letters goes counted');
});

test('secure means passed on three separate days after learning, last time too', () => {
  let s = { ...newState('x'), status: 'review', learnedDay: '2026-10-26', lastResult: 'pass', passDays: ['2026-10-26', '2026-10-27', '2026-10-28'] };
  assert.equal(isSecure(s), false);
  s = { ...s, passDays: [...s.passDays, '2026-10-30'] };
  assert.equal(isSecure(s), true);
  assert.equal(isWordPerfect(s), true);
});

test('applyResult leaves the old state untouched (undo keeps it)', () => {
  const s = newState('x');
  const copy = structuredClone(s);
  applyResult(s, { pass: true, day: 'd', time: 1, mode: 'type', queue: 'new' });
  assert.deepEqual(s, copy);
});

test('type check: one key per word, wrong keys and ? mark misses and move on', () => {
  const tokens = tokenize('(Texting.) On my way… wait—what?');
  const c = createTypeCheck(tokens);
  assert.equal(c.shownUpTo, 1); // the [Texting.] direction shows at once
  assert.deepEqual(c.press('o'), { index: 1, correct: true, done: false });
  assert.deepEqual(c.press('x'), { index: 2, correct: false, done: false });
  c.reveal();
  c.press('W');
  const last = c.press('w');
  assert.equal(last.done, true);
  assert.equal(c.press('w'), null);
  assert.deepEqual(c.misses, [2, 3]);
  assert.equal(c.shownUpTo, tokens.length);
  assert.equal(makeResult({ misses: c.misses, mode: 'type' }).pass, false);
});

test('say mode: tapped words are misses; directions cannot be tapped', () => {
  const tokens = tokenize('(Texting.) On my way.');
  assert.deepEqual(sayMisses(tokens, new Set([0, 3, 2])), [2, 3]);
  assert.equal(makeResult({ misses: [], mode: 'say' }).pass, true);
  assert.equal(makeResult({ misses: [], speakerWrong: true, mode: 'say' }).pass, false);
});

test('results are described in one plain sentence', () => {
  const tokens = tokenize('It was messy, everything was.');
  assert.equal(describeResult(makeResult({ misses: [], mode: 'type' }), tokens, 'Keeper'), 'Word perfect');
  assert.equal(describeResult(makeResult({ misses: [2, 3], mode: 'type' }), tokens, 'Keeper'), 'Two misses: messy, everything');
  assert.equal(describeResult(makeResult({ misses: [], speakerWrong: true, mode: 'type' }), tokens, 'Keeper'), 'It was Keeper');
});
