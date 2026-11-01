// Walk mode tapes: the plan turned into one continuous MP3, so nothing needs to run while the screen
// is locked. A tape is a list of steps (clips and silences) plus "trials": each time a line is to be
// recalled (its gap, then the answer). Marks and the review refer to trials.
// The tape is built the way a sprint runs, on a clock that moves with the tape: tests of whatever is
// ready at that point in the walk (from the forgetting curve), up to six at a time, in between new
// beats (today's, then a head start); then tests only; then, if the walk is longer still, one extra
// run of each scene, the least secure first. After that the tape ends, shorter than asked: a new
// tape later in the walk picks up whatever has become ready by then. A new beat is taught as a sprint
// teaches one: each line heard twice, with a gap to say it back, then the beat run from its cue, the
// first time its lines are asked for; its second run comes after the next beat's first. A beat part
// learned hears only the lines still to be taught, as a sprint teaches only those, and is run whole.
// A line's stage directions are read with it when it is taught and on its first run.
// While building, it assumes every recall is right; the real results are saved after the walk, at
// the moments they were heard.
import { applyResult, needsTeaching } from './state.js';
import { beatStage, extraRunsOf, phaseOf, readyLines, testsOf, REVIEW_BURST } from './plan.js';
import { dayKey } from './dates.js';
import { fnv1a } from './items.js';
import { STEPS } from './coach.js';

// How many times in a tape the coach says each thing.
export const COACH_FULL = 3;

// The key of a stage direction's clip in a pack, and how it is read aloud: without its brackets.
export const noteKey = (note) => fnv1a(note);
export const spokenNote = (note) => note.replace(/[[\]]/g, '');

export const GAP_FACTOR = { shorter: 0.75, normal: 1, longer: 1.4 };
// How long after a line is taught a tap still means that line.
const TAIL = 2;

// The clips of a line's cue, in order. A hearing on a card and a tape say it the same way. A cue made
// longer so that only one line fits (uniqueCues) plays the first lead line's cue and then each lead
// line, from clips the pack already has, or the usual clip if any of them is missing.
export function cueClips(it, index, manifest, long = true) {
  const audio = (id) => manifest.items[id];
  const more = long && index.cues && index.cues.get(it.id);
  const first = more && more.lead[0];
  const opener = first && (more.lines[0]?.speaker === null ? manifest.headings[it.scene] : audio(first)?.cue);
  if (opener && more.lead.every(audio)) return [opener, ...more.lead.map((id) => audio(id).line)];
  const one = it.cue.speaker === null ? manifest.headings[it.scene] : audio(it.id)?.cue;
  return one ? [one] : [];
}

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
  const teaching = []; // each line as it is taught, for the earbuds: { id, start, end }
  const guide = []; // what to do now, for the screen and the lock screen: { label, start }
  const unit = manifest.silence.duration;
  let t = 0;
  let missing = 0;
  let lastLabel = null;
  const skipped = new Set();
  const heard = []; // each new line, when it is first heard: { id, at }
  let pending = null; // the beat whose second run is still to come: { scene, ids, sec }
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
  // A line's cue: not to open a new beat, just before it is heard (long false).
  const cue = (it, long = true) => cueClips(it, index, manifest, long).forEach(clip);
  // The coach: a clip if the pack has one (a tape works without), and the same words on screen.
  const says = (key) => {
    const ref = manifest.coach && manifest.coach[key];
    if (ref) clip(ref);
  };
  const told = {};
  let said = 0; // where the last line heard began: the cue of the line after it
  const step = (key) => guide.push({ label: STEPS[key], start: t });
  // Said the first few times in a tape, then on the screen only: a walk's time is for the lines.
  const prompt = (key) => {
    told[key] = (told[key] || 0) + 1;
    step(key);
    if (told[key] <= COACH_FULL) says(key);
  };
  // The script's own direction, where the line has one.
  const directions = (it) => {
    for (const note of it.cue.notes || []) {
      const ref = manifest.notes && manifest.notes[noteKey(note)];
      if (!ref) continue;
      prompt('stage');
      clip(ref);
    }
  };
  const answer = (it) => {
    said = t;
    const name = manifest.speakers[it.speaker];
    if (name && it.askSpeaker) clip(name);
    clip(audio(it.id).line);
  };
  const recall = (it, queue, replayFrom) => {
    const begin = t;
    prompt('turn');
    silence(gapSeconds(it.words, gap));
    prompt('here');
    answer(it);
    trials.push({ id: it.id, queue, start: begin, answerEnd: t, end: t + 2, replayFrom });
    const time = start + t * 1000;
    sim.set(it.id, applyResult(stateOf(it.id), { pass: true, day: dayKey(new Date(time)), time, mode: 'walk', k }));
    silence(0.3);
  };
  const full = () => t + (pending ? pending.sec : 0) >= seconds; // time is kept for a second run to come
  const part = (label) => {
    if (label !== lastLabel) parts.push({ label, start: t });
    lastLabel = label;
  };
  const heading = (scene) => model.scenes[scene].heading;

  // A run of lines in script order: a cue only where the tape enters the scene.
  const sequence = (ids, queue, cueEvery, whole = false, staged = false) => {
    let prev = null;
    for (const id of ids) {
      if (full() && !whole) return;
      const it = byId.get(id);
      if (!usable(id)) {
        prev = null;
        continue;
      }
      const cued = cueEvery || !prev || prev.index !== it.index - 1 || prev.scene !== it.scene;
      const from = cued ? t : said;
      if (cued) {
        step('cue');
        cue(it);
      }
      if (staged) directions(it);
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

  // The beat before's second run, once something else has come between its runs.
  const secondRun = () => {
    if (!pending) return;
    const { scene, ids } = pending;
    pending = null;
    part(`New: ${heading(scene)}`);
    sequence(ids, 'beat', false, true);
  };

  // A new beat: each line still to be taught (never yet right from its cue) heard twice from its
  // cue, with a gap after each to say it back; lines already right once are not heard again, as a
  // sprint does not teach them again. Then the whole beat run from its first cue, the first time each
  // new line is asked for, a few minutes after it was heard. Its second run waits for the next beat
  // (or for the end of new beats). If it and its second run do not fit, as many of its lines as fit
  // are taught, up to half at a time; on a walk with nothing on it yet, at least one line.
  const learnBeat = (beat) => {
    const ids = beat.itemIds.filter(usable);
    if (!ids.length) return true;
    for (let n = ids.length; n >= 1; n = n === 1 ? 0 : Math.ceil(n / 2)) if (learnLines(beat, ids.slice(0, n))) return true;
    return false;
  };
  const learnLines = (beat, ids) => {
    const mark = { steps: steps.length, trials: trials.length, parts: parts.length, teaching: teaching.length, guide: guide.length, heard: heard.length, t, lastLabel, told: { ...told }, sim: new Map(sim) };
    part(`New: ${heading(beat.scene)}`);
    let prev = null;
    for (const id of ids.filter((x) => needsTeaching(stateOf(x)) && !(settings.typedOnly && stateOf(x).walks))) {
      const it = byId.get(id);
      const begin = t;
      prompt('listen');
      if (!prev || prev.index !== it.index - 1 || prev.scene !== it.scene) cue(it, false);
      directions(it);
      step('listen');
      heard.push({ id, at: t });
      answer(it);
      prompt('sayBack');
      silence(gapSeconds(it.words, gap));
      prompt('again');
      answer(it);
      prompt('sayBack');
      silence(gapSeconds(it.words, gap));
      teaching.push({ id, start: begin, end: t });
      prev = it;
    }
    const from = t;
    if (teaching.length > mark.teaching) prompt('run');
    sequence(ids, 'beat', false, true, true);
    const sec = t - from;
    if (t + sec + (pending ? pending.sec : 0) > seconds && (mark.trials > 0 || ids.length > 1)) {
      steps.length = mark.steps;
      trials.length = mark.trials;
      parts.length = mark.parts;
      teaching.length = mark.teaching;
      guide.length = mark.guide;
      for (const key of Object.keys(told)) told[key] = mark.told[key] || 0;
      heard.length = mark.heard;
      t = mark.t;
      lastLabel = mark.lastLabel;
      sim.clear();
      for (const [id, st] of mark.sim) sim.set(id, st);
      return false;
    }
    secondRun();
    pending = { scene: beat.scene, ids, sec };
    return true;
  };

  says('intro');
  // When walks prove nothing a beat walked stays new, so each walk starts from the beats walked least.
  const walkedLeast = (id) => Math.min(...beatById.get(id).itemIds.map((x) => getState(x).walks || 0));
  const beats = [...plan.newBeats, ...plan.ahead].filter((id) => beatById.has(id));
  if (settings.typedOnly) beats.sort((a, b) => walkedLeast(a) - walkedLeast(b));
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
      if (!id || !learnBeat(beatById.get(id))) {
        newDone = true;
        secondRun(); // the last new beat's second run, before checks only
      } else taught.add(id);
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
  secondRun();
  step('end');
  says('end');
  if (trials.length) trials[trials.length - 1].end = Math.max(trials[trials.length - 1].end, t); // the closing words too
  return { steps, trials, parts, teaching, guide, heard, duration: t, missing };
}

// Which trial a double tap at this moment means: the earliest one whose window (gap, answer and
// two seconds after) contains it, so a tap just after an answer marks that answer.
export function trialAt(trials, time) {
  return trials.findIndex((tr) => tr.start <= time && time <= tr.end);
}

const teachingAt = (tape, time, tail = 0) => tape.teaching.find((w) => w.start <= time && time <= w.end + tail);

// The trial a mark at this moment goes against. A line being taught has no answer yet, so a mark
// there goes against its first trial on the tape: it needs more help. -1 if no line is at hand.
export function markTrial(tape, time) {
  const i = trialAt(tape.trials, time);
  if (i >= 0) return i;
  const w = teachingAt(tape, time, TAIL);
  return w ? tape.trials.findIndex((tr) => tr.id === w.id) : -1;
}

// How many lines are marked: a line marked on two trials is one line, as the review shows it.
export const markedLines = (tape, marked) => new Set([...marked].map((i) => tape.trials[i].id)).size;

const replayFromOf = (tr) => tr.replayFrom ?? tr.start;

// Where back goes from this moment: the cue of the line at hand, or the start of a line being
// taught. null if no line is at hand.
export function replayPoint(tape, time) {
  const i = trialAt(tape.trials, time);
  if (i >= 0) return replayFromOf(tape.trials[i]);
  const w = teachingAt(tape, time, TAIL);
  if (w) return w.start;
  const next = tape.trials.find((tr) => replayFromOf(tr) <= time && time < tr.start);
  return next ? replayFromOf(next) : null;
}

// Where a tape picks up after a pause or a call: the cue of the line under way, or the start of a
// line being taught, so he never lands in a gap with nothing to go on. null: it carries on from here.
export function resumePoint(tape, time) {
  const tr = tape.trials.find((x) => replayFromOf(x) <= time && time < x.answerEnd);
  if (tr) return replayFromOf(tr);
  const w = teachingAt(tape, time);
  return w ? w.start : null;
}

// The part label playing now, for the lock screen.
export function partAt(parts, time) {
  let label = '';
  for (const p of parts) if (p.start <= time) label = p.label;
  return label;
}

// The review list: one row per line covered, in order, ticked if any of its trials was marked.
// Only trials whose answer was fully heard count, and marked ones, so a doubt is never lost: those
// not heard (unheard) are saved only if their row stays ticked.
export function reviewRows(tape, marked, stoppedAt = Infinity) {
  const rows = new Map();
  tape.trials.forEach((tr, i) => {
    const unheard = tr.answerEnd > stoppedAt;
    if (unheard && !marked.has(i)) return;
    const row = rows.get(tr.id) || { id: tr.id, trials: [], unheard: [], ticked: false };
    row.trials.push(i);
    if (unheard) row.unheard.push(i);
    if (marked.has(i)) row.ticked = true;
    rows.set(tr.id, row);
  });
  return [...rows.values()];
}

// Results to save, in tape order, each at the moment its answer was heard (seconds into the tape, at
// and tapeAt; the Walk screen moves at to the moment by the clock, if the tape was paused).
// A ticked row with no marked trial gets its last trial missed; an unticked row passes every trial.
export function walkResults(tape, rows, marked) {
  const missed = new Set();
  for (const row of rows) {
    if (!row.ticked) continue;
    const own = row.trials.filter((i) => marked.has(i));
    (own.length ? own : [row.trials[row.trials.length - 1]]).forEach((i) => missed.add(i));
  }
  return rows
    .flatMap((row) => (row.ticked ? row.trials : row.trials.filter((i) => !row.unheard.includes(i))))
    .sort((a, b) => a - b)
    .map((i) => ({ trial: i, id: tape.trials[i].id, queue: tape.trials[i].queue, pass: !missed.has(i), at: tape.trials[i].answerEnd, tapeAt: tape.trials[i].answerEnd }));
}

// After the walk: the results as events and new states, in order, for the app to save, each timed
// at the moment its answer was heard. start: when the tape began playing (ms). Each event carries the
// seconds of tape since the answer before (active), new lines heard in between included, so the
// whole walk counts as practice. Rounded on the running total, so that however long the walk, they
// add up to the tape time. A walk kept from days ago changes nothing on a line answered since: what
// came later is the truer picture. Nor does a walk saved twice, if the first save was cut off.
// typedOnly: walks prove nothing, as nobody hears whether the line was said, so a pass only records
// that the line was walked, and a mark still counts.
export function walkRecords(results, { start, getState, k = 1, typedOnly = false }) {
  const states = new Map();
  let prevAt = 0;
  const tenths = (x) => Math.round(x * 10) / 10;
  return results.flatMap((r) => {
    const time = start + r.at * 1000;
    const day = dayKey(new Date(time));
    const prev = states.get(r.id) || getState(r.id);
    if (Math.max(prev.lastTime ?? -Infinity, prev.walkTime ?? -Infinity) >= time) return [];
    const walked = () => ({ ...prev, status: prev.status === 'new' ? 'learning' : prev.status, firstDay: prev.firstDay ?? day, walks: (prev.walks || 0) + 1, walkTime: time });
    const state = r.pass && typedOnly ? walked() : applyResult(prev, { pass: r.pass, day, time, mode: 'walk', k, closeWord: prev.closeWord });
    states.set(r.id, state);
    const event = { time, day, id: r.id, pass: r.pass, mode: 'walk', queue: r.queue, misses: r.pass ? 0 : 1, speakerWrong: false, relearn: false, prev };
    if (r.tapeAt != null) {
      event.active = tenths(tenths(r.tapeAt) - prevAt);
      prevAt = tenths(r.tapeAt);
    }
    return [{ event, state }];
  });
}
