import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSeconds, checkBadges, cleanStreak, creditFor, newRounds, newStreak, noteSlips, rebuildStreak, ROUND_SECONDS, statusOf, streakDays, streakOf } from '../src/streak.js';

const R = ROUND_SECONDS;
const week = (...rounds) => Object.fromEntries(rounds.map((n, i) => [`2026-11-${String(i + 2).padStart(2, '0')}`, n * R])); // from Monday 2 November
const clean = (over = {}) => ({ percent: 0, lit: false, today: '2026-11-02', ...over });

test('a round is 20 minutes', () => {
  assert.equal(R, 1200);
});

test('time on a card earns only what the line could need, and a walk earns its tape', () => {
  assert.equal(creditFor({ active: 12, mode: 'type' }, 10), 12);
  assert.equal(creditFor({ active: 150, mode: 'say' }, 10), 50); // left open on a card
  assert.equal(creditFor({ active: 150, mode: 'type' }, 80), 120);
  assert.equal(creditFor({ active: 300, mode: 'walk' }, 10), 300);
  assert.equal(creditFor({ mode: 'type' }, 10), 0);
});

test('minutes add up across sittings, and an undone answer takes its time back', () => {
  const rec = newStreak();
  addSeconds(rec, '2026-11-02', 700);
  addSeconds(rec, '2026-11-02', 510);
  assert.equal(statusOf(rec, '2026-11-02').rounds, 1);
  addSeconds(rec, '2026-11-02', -20);
  const s = statusOf(rec, '2026-11-02');
  assert.equal(s.rounds, 0);
  assert.equal(s.minutes, 19);
  addSeconds(rec, '2026-11-02', -1190);
  assert.deepEqual(rec.days, {});
});

test('each medal keeps its own streak: a gold day keeps bronze and silver going', () => {
  const rec = cleanStreak({ days: week(4, 3, 2) });
  assert.deepEqual(statusOf(rec, '2026-11-04').medals.map((m) => m.days), [3, 2, 1]);
});

test('today only counts once it is won, and until then the streak stands', () => {
  const days = week(2, 2, 1);
  assert.equal(streakOf(days, 2, '2026-11-04').days, 2);
  assert.equal(streakOf(week(2, 2, 2), 2, '2026-11-04').days, 3);
});

test('the understudy covers one missed day a week, and adds nothing to the count', () => {
  const one = streakOf(week(2, 2, 0, 2), 2, '2026-11-05');
  assert.equal(one.days, 3);
  assert.equal(one.covered, null);
  const waiting = streakOf(week(2, 2, 0), 2, '2026-11-05');
  assert.equal(waiting.days, 2);
  assert.equal(waiting.covered, '2026-11-04');
  assert.equal(streakOf(week(2, 2, 0, 2, 0, 2), 2, '2026-11-07').days, 1); // a second miss in the week ends it
  assert.equal(streakOf(week(2, 2, 0, 0, 2), 2, '2026-11-06').days, 1); // two in a row end it
  // Sunday and the next Monday fall in different weeks, so each is covered.
  assert.equal(streakOf(week(2, 2, 2, 2, 2, 2, 0, 0, 2), 2, '2026-11-10').days, 7);
  assert.equal(streakOf({ '2026-11-02': 100, '2026-11-03': 2 * R }, 2, '2026-11-03').days, 1); // nothing to cover yet
});

test('what is left today', () => {
  const rec = cleanStreak({ days: { '2026-11-02': 2.5 * R } });
  const s = statusOf(rec, '2026-11-02');
  assert.equal(s.next.name, 'Silver');
  assert.equal(s.more, 1);
  assert.equal(s.minutes, 10);
  assert.equal(statusOf(cleanStreak({ days: { '2026-11-02': 4 * R } }), '2026-11-02').next, null);
});

test('a medal comes once, and a jump of two medals gives the higher', () => {
  const rec = cleanStreak({ days: { '2026-11-02': 3 * R } });
  assert.equal(newRounds(rec, '2026-11-02').medal.name, 'Silver');
  assert.equal(newRounds(rec, '2026-11-02'), null);
  addSeconds(rec, '2026-11-02', R);
  assert.equal(newRounds(rec, '2026-11-02').medal.name, 'Gold');
});

test('each badge is earned once, and stays when the % falls', () => {
  const rec = newStreak();
  assert.deepEqual(checkBadges(rec, clean({ percent: 60 })).map((b) => b.id), ['quarter', 'halfway']);
  assert.deepEqual(checkBadges(rec, clean({ percent: 10 })), []);
  assert.deepEqual(rec.badges, ['quarter', 'halfway']);
  rec.walks = 10;
  addSeconds(rec, '2026-11-02', R);
  assert.deepEqual(checkBadges(rec, clean({ lit: true })).map((b) => b.id), ['first-round', 'first-walk', 'ten-walks', 'scene-lit']);
});

test('streak badges come from the streak', () => {
  const rec = cleanStreak({ days: week(2, 2, 2) });
  assert.deepEqual(checkBadges(rec, clean({ today: '2026-11-04' })).map((b) => b.id), ['first-round', 'streak-3']);
  assert.equal(streakDays(rec, '2026-11-04'), 3);
});

test('Stage Ready needs 100% held for seven days, and a dip starts it again', () => {
  const rec = newStreak();
  checkBadges(rec, clean({ percent: 100, today: '2026-11-02' }));
  checkBadges(rec, clean({ percent: 99, today: '2026-11-03' }));
  checkBadges(rec, clean({ percent: 100, today: '2026-11-04' }));
  assert.deepEqual(checkBadges(rec, clean({ percent: 100, today: '2026-11-10' })), []);
  assert.deepEqual(checkBadges(rec, clean({ percent: 100, today: '2026-11-11' })).map((b) => b.id), ['stage-ready']);
});

const perfect = { id: 'a', status: 'review', lastResult: 'pass' };
const missed = { id: 'a', status: 'review', lastResult: 'miss' };

test('Comeback is a line that left the word perfect lines and came back, not a line missed while learning', () => {
  const rec = newStreak();
  noteSlips(rec, { id: 'a', status: 'learning' }, perfect);
  assert.equal(rec.won, false);
  noteSlips(rec, perfect, missed);
  assert.equal(rec.won, false);
  noteSlips(rec, missed, perfect);
  assert.equal(rec.won, true);
  assert.deepEqual(checkBadges(rec, clean()).map((b) => b.id), ['comeback']);
});

test('after the update, the streaks start from the practice already done: walks by their gaps', () => {
  const index = { byId: new Map([['a', { words: 10 }]]) };
  const at = (day, hour) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).getTime();
  const answer = (day, hour, mode, active) => ({ id: 'a', day, time: at(day, hour), mode, active });
  const rec = rebuildStreak(
    [answer('2026-10-30', 9, 'walk', 1300), answer('2026-10-30', 9, 'walk', 1200), answer('2026-10-30', 15, 'walk', 100), answer('2026-10-31', 12, 'type', 12), answer('2026-10-31', 13, 'type', 500), { id: 'gone', day: '2026-10-31', time: at('2026-10-31', 14), mode: 'type', active: 5 }],
    index,
  );
  assert.deepEqual(rec.days, { '2026-10-30': 2600, '2026-10-31': 62 });
  assert.equal(rec.walks, 2);
  assert.deepEqual(rec.badges, []);
});
