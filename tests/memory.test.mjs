import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrievability, hoursUntil, growth, afterMiss, recallNow, readyAt, fitFactor, FIRST, HOUR } from '../src/memory.js';
import { newState, applyResult } from '../src/state.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('the forgetting curve: 90% at the stability, quick at first, then slower', () => {
  assert.equal(retrievability(0, 5), 1);
  assert.ok(near(retrievability(5, 5), 0.9));
  assert.ok(near(hoursUntil(5), 5));
  assert.ok(near(hoursUntil(10, 0.95), 4.6056, 1e-3), 'a higher target comes round sooner');
  const drops = [0, 1, 2, 3].map((d) => retrievability(d * 10, 10) - retrievability((d + 1) * 10, 10));
  assert.ok(drops.every((d, i) => i === 0 || d < drops[i - 1]), 'each stretch loses less than the one before');
});

test('recall grows memory most when it was nearly forgotten, less once it is strong', () => {
  assert.ok(near(growth(1, 1), 1), 'straight after a test: nothing gained');
  assert.ok(growth(1, 0.95) < growth(1, 0.9) && growth(1, 0.9) < growth(1, 0.7));
  assert.ok(growth(100, 0.9) < growth(1, 0.9));
  assert.ok(growth(1, 0.9, 3) < growth(1, 0.9), 'a line that keeps slipping grows more slowly');
  assert.equal(growth(0.2, 0.05), 5, 'capped');
  assert.ok(near(afterMiss(100), 2) && near(afterMiss(0.2), 1 / 6), 'a miss comes back within 10 minutes to 2 hours');
});

test('a new line comes back once or twice more on the day it is learned, then less and less often', () => {
  const t0 = Date.UTC(2026, 9, 26, 9);
  const day = '2026-10-26';
  let s = applyResult(newState('x'), { pass: true, day, time: t0, mode: 'type', relearn: true });
  assert.equal(s.stability, FIRST.studied, 'first recalled after teaching: an hour');
  s = applyResult(s, { pass: true, day, time: t0 + 3 * 60000, mode: 'type' }); // beat run
  s = applyResult(s, { pass: true, day, time: t0 + 10 * 60000, mode: 'type' }); // beat run again
  assert.equal(s.status, 'review');
  const gaps = [];
  for (let i = 0; i < 6; i++) {
    const when = readyAt(s);
    gaps.push((when - s.lastTime) / HOUR);
    s = applyResult(s, { pass: true, day, time: when, mode: 'type' });
  }
  assert.ok(gaps.every((g, i) => i === 0 || g > gaps[i - 1]), `expanding: ${gaps.map((g) => g.toFixed(2)).join(', ')}`);
  assert.ok(gaps[0] >= 1 && gaps[0] < 2 && gaps[0] + gaps[1] < 6, 'about an hour, then a few hours: once or twice more that day');
  assert.ok(gaps[2] > 8, 'then not until late that day or the next');
  const known = applyResult(newState('y'), { pass: true, day, time: t0, mode: 'type', pretest: true });
  assert.equal(known.stability, FIRST.known, 'known before being taught: 4 hours');
});

test('a miss cuts memory; the check straight after relearning does not grow it', () => {
  const t0 = Date.UTC(2026, 9, 26, 9);
  let s = { ...newState('x'), status: 'review', passes: 3, stability: 48, lastTime: t0, lastResult: 'pass' };
  s = applyResult(s, { pass: false, day: 'd', time: t0 + 24 * HOUR, mode: 'type' });
  assert.deepEqual([s.stability, s.lapses, s.lastResult], [2, 1, 'miss']);
  const relearned = applyResult(s, { pass: true, day: 'd', time: t0 + 24 * HOUR + 30000, mode: 'type', relearn: true });
  assert.equal(relearned.stability, 2);
  assert.equal(relearned.lastResult, 'pass');
  assert.equal(recallNow(relearned, relearned.lastTime), 1);
});

test('right from the cue alone just after the first letters, or right but slow: memory grows by half as much', () => {
  const t0 = Date.UTC(2026, 9, 26, 9);
  const s = { ...newState('x'), status: 'review', passes: 2, stability: 10, lastTime: t0, lastResult: 'pass' };
  const later = { pass: true, day: 'd', time: t0 + 20 * HOUR, mode: 'say' };
  const free = applyResult(s, later).stability / 10;
  const helped = applyResult(s, { ...later, primed: true }).stability / 10;
  assert.ok(free > 2, `free: x${free.toFixed(2)}`);
  assert.ok(near(helped - 1, (free - 1) / 2), `helped: x${helped.toFixed(2)}`);
  const slow = applyResult(s, { ...later, slow: true }).stability / 10;
  assert.ok(near(slow, helped), 'right but slow, hard to find: the same');
});

test('the personal factor: fitted from his results, near 1 until there is enough evidence', () => {
  // Invented results from someone whose lines last twice as long as the curve expects.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const events = [];
  for (let i = 0; i < 400; i++) {
    const s = [0.5, 2, 8, 24][i % 4];
    const t = s * (0.5 + 2.5 * rand());
    const pass = rand() < retrievability(t, 2 * s);
    events.push({ time: 1e12 + t * HOUR, pass, mode: 'type', prev: { status: 'review', stability: s, lastTime: 1e12 } });
  }
  const fit = fitFactor(events);
  assert.ok(fit.k > 1.5 && fit.k < 2.7, `k = ${fit.k}`);
  assert.equal(fit.n, 400);
  assert.equal(fitFactor(events.slice(0, 20)).k, 1, 'too little evidence');
  assert.equal(fitFactor(events.map((e) => ({ ...e, mode: 'walk' }))).n, 0, 'walks are left out');
  assert.equal(fitFactor(events.map((e, i) => ({ ...e, help: i % 2 === 0, primed: i % 2 === 1 }))).n, 0, 'goes with the first letters, and the go just after, are left out');
});
