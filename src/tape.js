// Walk mode tapes: the plan turned into one continuous MP3, so nothing needs to run while the screen
// is locked. A tape is a list of steps (clips and silences) plus "trials": each time a line is to be
// recalled (its gap, then the answer). Marks and the review refer to trials.
// The tape is built the way a sprint runs, on a clock that moves with the tape: tests of whatever is
// ready at that point in the walk (from the forgetting curve), up to six at a time, in between new
// beats (today's, then a head start); then tests only; then, if the walk is longer still, one extra
// run of each scene, the least secure first. After that the tape ends, shorter than asked: a new
// tape later in the walk picks up whatever has become ready by then.
// While building, it assumes every recall is right; the real results are saved after the walk, at
// the moments they were heard.
import { applyResult } from './state.js';
import { beatStage, extraRunsOf, phaseOf, readyLines, testsOf, REVIEW_BURST } from './plan.js';
import { dayKey } from './dates.js';

export const GAP_FACTOR = { shorter: 0.75, normal: 1, longer: 1.4 };

// Time to say the line: about 2.3 words a second, plus 1.5 seconds to find it.
export function gapSeconds(words, setting = 'normal') {
  return (words / 2.3 + 1.5) * (GAP_FACTOR[setting] ?? 1);
}

// start: when the walk begins (ms). seconds: how long it should last.
export function buildWalk({ model, index, manifest, getState, settings, plan, start, seconds, gap = 'normal' }) {
  const { byId, beatById } = index;
  const k = plan.k;
  const steps = [];
  const trials = [];
  const parts = [];
  const unit = manifest.silence.duration;
  let t = 0;
  let missing = 0;
  let lastLabel = null;
  const skipped = new Set();
  const sim = new Map(); // states as they will be if every recall on the tape is right
  const stateOf = (id) => sim.get(id) || getState(id);

  const clip = (ref) => {
    steps.push({ clip: ref.file, dur: ref.duration });
    t += ref.duration;
  };
  const silence = (sec) => {
    const n = Math.max(1, Math.round(sec / unit));
    steps.push({ silence: n, dur: n * unit });
    t += n * unit;
  };
  const audio = (id) => manifest.items[id];
  const usable = (id) => {
    if (audio(id)) return true;
    if (!skipped.has(id)) {
      skipped.add(id);
      missing += 1;
    }
    return false;
  };
  const cue = (it) => clip(it.cue.speaker === null ? manifest.headings[it.scene] : audio(it.id).cue);
  const answer = (it) => {
    const name = manifest.speakers[it.speaker];
    if (name && it.askSpeaker) clip(name);
    clip(audio(it.id).line);
  };
  const recall = (it, queue, replayFrom) => {
    const begin = t;
    silence(gapSeconds(it.words, gap));
    answer(it);
    trials.push({ id: it.id, queue, start: begin, answerEnd: t, end: t + 2, replayFrom });
    const time = start + t * 1000;
    sim.set(it.id, applyResult(stateOf(it.id), { pass: true, day: dayKey(new Date(time)), time, mode: 'walk', k }));
    silence(0.3);
  };
  const full = () => t >= seconds;
  const part = (label) => {
    if (label !== lastLabel) parts.push({ label, start: t });
    lastLabel = label;
  };
  const heading = (scene) => model.scenes[scene].heading;

  // A run of lines in script order: a cue only where the tape enters the scene.
  const sequence = (ids, queue, cueEvery, whole = false) => {
    let prev = null;
    for (const id of ids) {
      if (full() && !whole) return;
      const it = byId.get(id);
      if (!usable(id)) {
        prev = null;
        continue;
      }
      const from = t;
      if (cueEvery || !prev || prev.index !== it.index - 1 || prev.scene !== it.scene) cue(it);
      recall(it, queue, from);
      prev = it;
    }
  };

  const runTest = (test) => {
    if (test.kind === 'run') {
      part(`Run: ${heading(test.scene)}`);
      sequence(test.itemIds, 'run', false);
    } else {
      part('Check');
      sequence([test.id], 'due', true);
    }
  };

  // A new beat: listen, repeat, listen, repeat, recall from the cue, line by line; then the beat run
  // twice from its first cue. A beat is learned whole: if it does not fit, it is left for another time.
  const learnBeat = (beat) => {
    const ids = beat.itemIds.filter(usable);
    if (!ids.length) return true;
    const mark = { steps: steps.length, trials: trials.length, parts: parts.length, t, lastLabel, sim: new Map(sim) };
    part(`New: ${heading(beat.scene)}`);
    for (const id of ids) {
      const it = byId.get(id);
      const from = t;
      for (let n = 0; n < 2; n++) {
        answer(it);
        silence(gapSeconds(it.words, gap));
      }
      cue(it);
      recall(it, 'new', from);
    }
    sequence(ids, 'beat', false, true);
    sequence(ids, 'beat', false, true);
    if (t > seconds && mark.trials > 0) {
      steps.length = mark.steps;
      trials.length = mark.trials;
      parts.length = mark.parts;
      t = mark.t;
      lastLabel = mark.lastLabel;
      sim.clear();
      for (const [id, s] of mark.sim) sim.set(id, s);
      return false;
    }
    return true;
  };

  const beats = [...plan.newBeats, ...plan.ahead].filter((id) => beatById.has(id));
  const taught = new Set();
  const extraDone = new Set(); // an extra run of each scene at most once a tape
  let tests = 0;
  let newDone = false;
  while (!full()) {
    const now = start + t * 1000;
    const today = dayKey(new Date(now));
    const phase = phaseOf(today, settings);
    const ready = readyLines({ model, getState: stateOf, now, today, k, phase });
    for (const id of [...ready.keys()]) if (!usable(id)) ready.delete(id);
    const test = testsOf({ model, index, getState: stateOf, ready, phase, today })[0];
    const before = trials.length;
    if (test && (newDone || tests < REVIEW_BURST)) {
      runTest(test);
      tests += trials.length - before;
    } else if (!newDone) {
      const id = beats.find((b) => !taught.has(b) && beatStage(beatById.get(b), stateOf) !== 'done');
      if (!id || !learnBeat(beatById.get(id))) newDone = true;
      else taught.add(id);
      tests = 0;
      continue;
    } else {
      const extra = extraRunsOf({ model, index, getState: stateOf, now, k, skip: extraDone })[0];
      if (!extra) break; // everything useful for now is on the tape: it ends early
      extraDone.add(extra.scene);
      runTest(extra);
    }
    if (trials.length === before) break; // nothing more can be added
  }
  return { steps, trials, parts, duration: t, missing };
}

// Which trial a double tap at this moment means: the earliest one whose window (gap, answer and
// two seconds after) contains it, so a tap just after an answer marks that answer.
export function trialAt(trials, time) {
  return trials.findIndex((tr) => tr.start <= time && time <= tr.end);
}

// The part label playing now, for the lock screen.
export function partAt(parts, time) {
  let label = parts.length ? parts[0].label : '';
  for (const p of parts) if (p.start <= time) label = p.label;
  return label;
}

// The review list: one row per line covered, in order, ticked if any of its trials was marked.
// Only trials whose answer was fully heard count.
export function reviewRows(tape, marked, stoppedAt = Infinity) {
  const rows = new Map();
  tape.trials.forEach((tr, i) => {
    if (tr.answerEnd > stoppedAt) return;
    const row = rows.get(tr.id) || { id: tr.id, trials: [], ticked: false };
    row.trials.push(i);
    if (marked.has(i)) row.ticked = true;
    rows.set(tr.id, row);
  });
  return [...rows.values()];
}

// Results to save, in tape order, each at the moment its answer was heard (seconds into the tape).
// A ticked row with no marked trial gets its last trial missed; an unticked row passes every trial.
export function walkResults(tape, rows, marked) {
  const missed = new Set();
  for (const row of rows) {
    if (!row.ticked) continue;
    const own = row.trials.filter((i) => marked.has(i));
    (own.length ? own : [row.trials[row.trials.length - 1]]).forEach((i) => missed.add(i));
  }
  return rows
    .flatMap((row) => row.trials)
    .sort((a, b) => a - b)
    .map((i) => ({ trial: i, id: tape.trials[i].id, queue: tape.trials[i].queue, pass: !missed.has(i), at: tape.trials[i].answerEnd }));
}

// After the walk: the results as events and new states, in order, for the app to save, each timed
// at the moment its answer was heard. start: when the tape began playing (ms).
export function walkRecords(results, { start, getState, k = 1 }) {
  const states = new Map();
  return results.map((r) => {
    const time = start + r.at * 1000;
    const day = dayKey(new Date(time));
    const prev = states.get(r.id) || getState(r.id);
    const state = applyResult(prev, { pass: r.pass, day, time, mode: 'walk', k });
    states.set(r.id, state);
    return { event: { time, day, id: r.id, pass: r.pass, mode: 'walk', queue: r.queue, misses: r.pass ? 0 : 1, speakerWrong: false, relearn: false, prev }, state };
  });
}
