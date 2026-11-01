import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeApp, fixtureModel, learn } from './helpers.mjs';
import { buildWalk, markedLines, markTrial, partAt, replayPoint, resumePoint, reviewRows, trialAt, walkRecords, walkResults } from '../src/tape.js';
import { COACH, COACH_SPEECH, STEPS } from '../src/coach.js';
import { createPlayer } from '../src/player.js';
import { clipTexts, speechManifest } from '../src/ui/walk.js';
import { newState, needsTeaching } from '../src/state.js';

const clipRef = (file, duration = 1) => ({ file, duration });
function manifestOf(model, { coach = true } = {}) {
  const items = {};
  for (const it of model.items) items[it.id] = { line: clipRef(`l-${it.id}`), cue: it.cue.speaker === null ? null : clipRef(`c-${it.id}`) };
  const m = { silence: clipRef('s', 0.25), items, speakers: {}, headings: Object.fromEntries(model.scenes.map((s) => [s.index, clipRef(`h-${s.index}`)])) };
  for (const it of model.items) m.speakers[it.speaker] = clipRef(`p-${it.speaker}`);
  if (coach) m.coach = Object.fromEntries(Object.keys(COACH).map((k) => [k, clipRef(`coach-${k}`)]));
  return m;
}

function walk(app, manifest, seconds = 300) {
  const plan = app.plan();
  return buildWalk({ model: app.model, index: app.index, manifest, getState: app.getState, settings: app.settings, plan, start: app.clock, seconds });
}

const files = (tape) => tape.steps.filter((s) => s.clip).map((s) => s.clip);

test('a new line: listen, its line, say it back, once more, its line, say it back', () => {
  const app = fakeApp();
  const list = files(walk(app, manifestOf(app.model), 900)).filter((f) => !f.startsWith('p-'));
  const first = list.indexOf('coach-listen');
  assert.equal(list[0], 'coach-intro');
  assert.ok(first >= 0);
  const line = list.slice(first).find((f) => f.startsWith('l-'));
  const at = list.indexOf(line, first);
  assert.deepEqual(list.slice(at, at + 4), [line, 'coach-sayBack', 'coach-again', line]);
  assert.equal(list[at + 4], 'coach-sayBack');
  assert.equal(list[list.length - 1], 'coach-end');
});

test('the coach gives the full words three times in a tape, then keeps to the short ones or none', () => {
  const app = fakeApp();
  const tape = walk(app, manifestOf(app.model), 1800);
  const list = files(tape);
  const count = (key) => list.filter((f) => f === `coach-${key}`).length;
  for (const key of ['turn', 'here', 'listen', 'again']) assert.equal(count(key), 3, key);
  assert.ok(count('turnShort') > 0);
  assert.ok(count('run') <= 3);
  const i = tape.steps.findIndex((s) => s.clip === 'coach-turn');
  assert.ok(tape.steps[i + 1].silence > 0);
  assert.equal(tape.steps[i + 2].clip, 'coach-here');
});

test('who speaks is still asked after the gap, as it always was', () => {
  const app = fakeApp();
  const tape = walk(app, manifestOf(app.model), 1800);
  const tr = tape.trials.find((x) => app.index.byId.get(x.id).askSpeaker);
  assert.ok(tr);
  let t = 0;
  const timed = tape.steps.map((s) => ({ ...s, at: (t += s.dur) - s.dur }));
  const line = timed.findLast((s) => s.clip === `l-${tr.id}` && s.at < tr.answerEnd);
  const before = timed[timed.indexOf(line) - 1];
  assert.ok(before.clip.startsWith('p-'), 'the name just before the line, after the gap');
});

test('the guide says what to do at every moment of the tape', () => {
  const app = fakeApp();
  const tape = walk(app, manifestOf(app.model), 900);
  assert.equal(partAt(tape.guide, tape.guide[0].start), STEPS.listen);
  assert.ok(tape.guide.some((g) => g.label === STEPS.turn));
  for (let i = 1; i < tape.guide.length; i++) assert.ok(tape.guide[i].start >= tape.guide[i - 1].start);
  assert.equal(partAt(tape.guide, tape.duration), STEPS.end);
});

test('a pack with no coach makes the same tape as before', () => {
  const app = fakeApp();
  const list = files(walk(app, manifestOf(app.model, { coach: false }), 900));
  assert.ok(list.every((f) => !f.startsWith('coach-')));
});

test('a line being taught: a mark counts against its first trial, and back goes to the start of its teaching', () => {
  const app = fakeApp();
  const tape = walk(app, manifestOf(app.model), 900);
  const w = tape.teaching[1];
  assert.equal(tape.teaching.length, tape.heard.length);
  const first = tape.trials.findIndex((tr) => tr.id === w.id);
  assert.equal(trialAt(tape.trials, w.start + 3), -1, 'no answer yet');
  assert.equal(markTrial(tape, w.start + 3), first);
  assert.equal(tape.teaching[0].id, tape.trials[markTrial(tape, w.start + 1)].id, 'a tap just after a line is for that line');
  assert.equal(markTrial(tape, w.end - 0.1), first);
  assert.equal(replayPoint(tape, w.end - 0.1), w.start);
  assert.equal(markTrial(tape, 0.5), -1, 'the intro is not a line');
  assert.equal(replayPoint(tape, 0.5), null);
  const marked = new Set([first]);
  const rows = reviewRows(tape, marked, w.end); // the walk stopped before the line's first answer
  assert.deepEqual(rows.map((r) => [r.id, r.ticked]), [[w.id, true]]);
  const [result] = walkResults(tape, rows, marked);
  assert.equal(result.pass, false);
  const [rec] = walkRecords([result], { start: app.clock, getState: app.getState });
  assert.ok(needsTeaching(rec.state), 'it is taught again');
});

test('marks and the count agree: a mark in a gap is kept, a line marked twice is one line, and a doubt let go is not saved', () => {
  const tape = { trials: [{ id: 'a', queue: 'run', answerEnd: 5 }, { id: 'b', queue: 'run', answerEnd: 10 }, { id: 'a', queue: 'beat', answerEnd: 15 }] };
  const marked = new Set([0, 1, 2]);
  assert.equal(markedLines(tape, marked), 2);
  const rows = reviewRows(tape, marked, 6); // stopped in the second line's gap
  assert.deepEqual(rows.map((r) => [r.id, r.ticked]), [['a', true], ['b', true]]);
  assert.equal(rows.filter((r) => r.ticked).length, markedLines(tape, marked));
  rows[1].ticked = false; // not heard, and let go: nothing to say about it
  assert.deepEqual(walkResults(tape, rows, marked).map((r) => r.id), ['a', 'a']);
});

test('a tap during the closing words still marks the last line', () => {
  const app = fakeApp();
  const tape = walk(app, manifestOf(app.model), 900);
  assert.equal(trialAt(tape.trials, tape.duration - 0.1), tape.trials.length - 1);
});

test('the words and the screen move together', () => {
  const app = fakeApp();
  const tape = walk(app, manifestOf(app.model), 1800);
  let t = 0;
  const timed = tape.steps.map((s) => ({ ...s, at: (t += s.dur) - s.dur }));
  const at = (file) => timed.find((s) => s.clip === file).at;
  const on = (time) => partAt(tape.guide, time);
  assert.equal(on(at('coach-run')), STEPS.run);
  assert.equal(on(at('coach-end')), STEPS.end);
  // A check's next cue is under Listen for your cue, not the check before it.
  const cues = tape.trials.slice(1).map((tr) => timed.find((s) => s.clip === `c-${tr.id}` && s.at >= tr.replayFrom - 1e-9 && s.at < tr.start));
  assert.ok(cues.some(Boolean));
  for (const cue of cues.filter(Boolean)) assert.equal(on(cue.at), STEPS.cue);
});

test('Now run those lines is said only when lines were just taught', () => {
  const count = (tape) => files(tape).filter((f) => f === 'coach-run').length;
  const app = fakeApp();
  assert.ok(count(walk(app, manifestOf(app.model), 900)) > 0);
  // Every line right once: nothing to teach, so the beats are only run.
  const again = fakeApp();
  for (const id of again.model.items.map((x) => x.id)) again.states.set(id, { ...newState(id), status: 'learning', firstDay: again.today, passes: 1, passDays: [again.today], stability: 1, lastResult: 'pass', lastDay: again.today, lastTime: again.clock - 6 * 60000 });
  const tape = walk(again, manifestOf(again.model), 900);
  assert.equal(tape.heard.length, 0);
  assert.ok(tape.trials.length > 0);
  assert.equal(count(tape), 0);
});

test('resume: from the line\'s cue, from the start of a line being taught, or on from where it was', () => {
  const app = fakeApp();
  learn(app, app.model.beats[0].itemIds, { stability: 24, hoursAgo: 48 });
  const tape = walk(app, manifestOf(app.model), 900);
  const tr = tape.trials[2];
  assert.equal(resumePoint(tape, tr.start + 0.5), tr.replayFrom, 'in the gap: back to its cue');
  const ends = tape.trials.find((x, i) => tape.trials[i + 1] && tape.trials[i + 1].replayFrom >= x.answerEnd);
  assert.equal(resumePoint(tape, ends.answerEnd + 0.1), null, 'after the answer: nothing to go back for');
  const leads = tape.trials.findIndex((x, i) => tape.trials[i + 1] && tape.trials[i + 1].replayFrom < x.answerEnd);
  assert.ok(leads >= 0);
  assert.ok(tape.trials[leads + 1].replayFrom > tape.trials[leads].start, 'a line that follows on: its cue is the line before');
  assert.equal(resumePoint(tape, tape.trials[leads].answerEnd + 0.1), tape.trials[leads + 1].replayFrom);
  const w = tape.teaching[0];
  assert.equal(resumePoint(tape, w.end - 0.1), w.start);
  assert.equal(resumePoint(tape, 0.5), null, 'the intro just carries on');
});

test('the player resumes from where it is told, after a pause, and not after the tape ends or at the start', async () => {
  class FakeAudio extends EventTarget {
    currentTime = 0;
    paused = true;
    ended = false;
    play() {
      this.paused = false;
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
      this.dispatchEvent(new Event('pause'));
    }
  }
  const real = globalThis.Audio;
  globalThis.Audio = FakeAudio;
  try {
    const asked = [];
    const player = createPlayer({ resumeFrom: (t) => (asked.push(t), t > 10 ? 7 : null) });
    await player.play();
    assert.deepEqual(asked, [], 'the first play is not a resume');
    player.audio.currentTime = 12;
    player.pause();
    await player.play();
    assert.equal(player.time, 7);
    player.audio.currentTime = 3;
    player.pause();
    await player.play();
    assert.equal(player.time, 3, 'nowhere to go back to: it carries on');
    assert.deepEqual(asked, [12, 3]);
    player.audio.ended = true;
    player.pause();
    await player.play();
    assert.equal(asked.length, 2);
  } finally {
    globalThis.Audio = real;
  }
});

test('the coach: says aloud and what a tap does; the phone reading aloud never mentions earbuds', () => {
  assert.match(COACH.intro, /aloud/);
  assert.match(COACH_SPEECH.intro, /aloud/);
  assert.doesNotMatch(COACH_SPEECH.intro, /earbud/);
  assert.match(COACH.end, /tick any you missed/);
  const { model } = fixtureModel();
  const manifest = speechManifest(model);
  assert.equal(clipTexts(manifest, model).get(manifest.coach.intro.file), COACH_SPEECH.intro);
  for (const text of [...Object.values(COACH), ...Object.values(COACH_SPEECH), ...Object.values(STEPS)]) assert.doesNotMatch(text, /[—–]/);
});

test('a walk kept from days ago changes nothing on a line answered since, and a walk half saved is not counted twice', () => {
  const later = { ...newState('a'), status: 'review', lastTime: 5000 };
  const fresh = newState('b');
  const done = { ...newState('c'), status: 'review', lastTime: 4000 };
  const states = { a: later, b: fresh, c: done };
  const records = walkRecords([{ id: 'a', pass: false, at: 1, queue: 'run' }, { id: 'b', pass: true, at: 2, queue: 'run' }, { id: 'c', pass: true, at: 3, queue: 'run' }], { start: 1000, getState: (id) => states[id] });
  assert.deepEqual(records.map((r) => r.event.id), ['b']);
});
