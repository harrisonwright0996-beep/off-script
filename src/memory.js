// The forgetting curve, line by line. Nothing is scheduled for a time of day: whenever the app is
// open, the plan works out each line's chance of recall at that moment.
// Every line he has recalled has a stability S, in hours: how long until the chance of saying it
// word perfect falls to 90%. t hours after it was last tested the chance is R = (1 + F t / S)^(-1/2),
// a power curve: forgetting is quick at first, then slows (F = 19/81 puts R at 0.9 when t = S).
// * A brand new line starts at 10 minutes (4 hours if he knew it before being taught), so it comes
//   back several times on the day it is learned, then less and less often.
// * Recalling it multiplies S: most when it was close to being forgotten (the spacing effect), less
//   as S gets large, and less for a line that keeps slipping.
// * Recalling it just after a go with the first letters grows S by half as much: the first letters
//   did some of the work.
// * Missing it cuts S to between 10 minutes and 2 hours, so it comes back soon.
// * A personal factor k, fitted to his own results, stretches or shrinks every S: if his lines last
//   longer than the curve expects, checks spread out; if they slip sooner, checks come round sooner.
export const HOUR = 3600000;
export const TARGET = 0.9; // a line is ready to test when its chance of recall falls to 90%
export const OPENING_TARGET = 0.95; // scene openings, which have no line before them to lead in
export const FIRST = { studied: 1 / 6, known: 4 }; // hours: first recalled after teaching, or before it
export const HELPED_GROWTH = 0.5; // the share of the growth when the first letters came just before
const F = 19 / 81;
const MIN_STABILITY = 1 / 6;
const AFTER_MISS_MAX = 2;
const MAX_GROWTH = 5;

export function retrievability(hours, stability) {
  return Math.pow(1 + (F * Math.max(0, hours)) / stability, -0.5);
}

// Hours from a test until the chance of recall falls to the target.
export function hoursUntil(stability, target = TARGET) {
  return (stability / F) * (Math.pow(target, -2) - 1);
}

// What a correct recall multiplies S by, given the chance of recall it was made at.
export function growth(stability, r, lapses = 0) {
  const ease = 1 / (1 + 0.15 * Math.min(lapses, 10));
  return Math.min(MAX_GROWTH, 1 + 18 * Math.pow(stability, -0.12) * (Math.exp(1 - r) - 1) * ease);
}

export const afterMiss = (stability) => Math.min(AFTER_MISS_MAX, Math.max(MIN_STABILITY, stability * 0.2));

// The chance of recall now; null for a line never recalled.
export function recallNow(s, now, k = 1) {
  if (s.stability == null || !s.lastTime) return null;
  return retrievability((now - s.lastTime) / HOUR, k * s.stability);
}

// The moment the chance of recall falls to the target.
export function readyAt(s, k = 1, target = TARGET) {
  return s.lastTime + hoursUntil(k * s.stability, target) * HOUR;
}

// The personal factor, from his results on learned lines: the most recent 500 tests at least five
// minutes after the last one, leaving out walks (marked by memory afterwards), relearning after a miss,
// goes with the first letters and the go from the cue alone just after one (the first letters made it
// easier). A prior keeps k near 1 until the evidence is clear. k runs from 1/3 to 3.
export function fitFactor(events) {
  const obs = events
    .filter((e) => e.prev && e.prev.status === 'review' && e.prev.stability && e.prev.lastTime && e.mode !== 'walk' && !e.relearn && !e.help && !e.primed)
    .map((e) => ({ t: (e.time - e.prev.lastTime) / HOUR, s: e.prev.stability, pass: e.pass }))
    .filter((o) => o.t >= 5 / 60)
    .slice(-500);
  if (obs.length < 30) return { k: 1, n: obs.length };
  let best = { k: 1, score: -Infinity };
  for (let i = -40; i <= 40; i++) {
    const k = Math.exp(i * 0.0275);
    let score = -(Math.log(k) ** 2) / (2 * 0.35 ** 2);
    for (const o of obs) {
      const r = Math.min(0.999, Math.max(0.001, retrievability(o.t, k * o.s)));
      score += o.pass ? Math.log(r) : Math.log(1 - r);
    }
    if (score > best.score) best = { k, score };
  }
  return { k: best.k, n: obs.length };
}
