import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameHeader, parseMp3, concatBytes } from '../src/mp3.js';
import { gapSeconds, buildWalk, trialAt, partAt, reviewRows, walkResults, walkRecords } from '../src/tape.js';
import { readAudioPack, packFit, PackError } from '../src/audiopack.js';
import { silentMp3, buildFixturePack } from './fixtures/audio-pack.mjs';
import { fakeApp, learn } from './helpers.mjs';
import { strToU8, zipSync } from '../vendor/fflate.js';

test('frame headers: MPEG 2 Layer III, 22,050 Hz, mono, 32 kbps is 104 bytes, 105 with padding', () => {
  const h = frameHeader(new Uint8Array([0xff, 0xf3, 0x40, 0xc4]), 0);
  assert.deepEqual(h, { version: 2, bitrate: 32000, sampleRate: 22050, samples: 576, channels: 1, length: 104 });
  assert.equal(frameHeader(new Uint8Array([0xff, 0xf3, 0x42, 0xc4]), 0).length, 105);
  assert.equal(frameHeader(new Uint8Array([0x49, 0x44, 0x33, 0x04]), 0), null);
});

test('clips: frames counted exactly, tags skipped, and joined clips add up', () => {
  const a = silentMp3(40);
  const tagged = concatBytes([new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 2, 9, 9]), a, strToU8('TAG' + ' '.repeat(125))]);
  const p = parseMp3(tagged);
  assert.equal(p.frames, 40);
  assert.equal(p.bytes.length, 40 * 104);
  assert.ok(Math.abs(p.duration - (40 * 576) / 22050) < 1e-9);
  const joined = parseMp3(concatBytes([a, silentMp3(10), a]));
  assert.equal(joined.frames, 90);
  assert.throws(() => parseMp3(strToU8('not audio')), /not-mp3/);
});

test('gaps: words over 2.3 plus 1.5 seconds, scaled by the setting', () => {
  assert.equal(gapSeconds(23), 11.5);
  assert.equal(gapSeconds(0, 'longer'), 1.5 * 1.4);
});

test('audio pack: reads, checks clips, and reports fit with the script', () => {
  const app = fakeApp();
  const { manifest, clips } = readAudioPack(buildFixturePack(app.model));
  assert.equal(clips.size, 1 + app.model.items.length * 2 + 9 + app.model.scenes.length);
  assert.deepEqual(packFit(manifest, app.model), { sameScript: true, have: 23, missing: 0 });
  const partial = readAudioPack(buildFixturePack(app.model, { skip: 3 })).manifest;
  assert.deepEqual(packFit(partial, app.model), { sameScript: true, have: 20, missing: 3 });
  assert.throws(() => readAudioPack(strToU8('nope')), (e) => e instanceof PackError && e.code === 'not-zip');
  assert.throws(() => readAudioPack(zipSync({ 'a.txt': strToU8('x') })), (e) => e.code === 'no-manifest');
});

function walkApp() {
  const app = fakeApp();
  const { manifest } = readAudioPack(buildFixturePack(app.model));
  // The Prologue and the first beat of Scene 1 learned on earlier days, both ready now.
  const firstDay = '2026-10-24';
  learn(app, app.model.scenes[0].itemIds, { stability: 24, hoursAgo: 48, firstDay });
  learn(app, app.model.beats[1].itemIds, { stability: 24, hoursAgo: 30, firstDay });
  return { app, manifest };
}

const walk = (app, manifest, seconds) =>
  buildWalk({ model: app.model, index: app.index, manifest, getState: app.getState, settings: app.settings, plan: app.plan(), start: app.clock, seconds });

test('a walk tape runs like a sprint: what is ready, then new beats, then one extra run of each scene', () => {
  const { app, manifest } = walkApp();
  const tape = walk(app, manifest, 3600);
  assert.deepEqual(tape.parts.slice(0, 3).map((p) => p.label), ['Run: Prologue', 'Run: Scene 1: The Harbour', 'New: Scene 1: The Harbour']);
  assert.equal(tape.missing, 0);
  const total = tape.steps.reduce((n, s) => n + s.dur, 0);
  assert.ok(Math.abs(total - tape.duration) < 1e-6);
  const firstNew = tape.trials.find((t) => t.id === tape.heard[0].id);
  assert.deepEqual(tape.trials.filter((t) => t.id === firstNew.id).slice(0, 3).map((t) => t.queue), ['beat', 'beat', 'run']);
  assert.ok(tape.duration < 3600, 'it stops once everything useful for now is on it');
  const scenes = tape.parts.filter((p) => p.label.startsWith('Run:')).map((p) => p.label);
  assert.ok(scenes.length <= 2 + 3, 'no scene is run over and over');
  const short = walk(app, manifest, 60);
  assert.ok(short.duration >= 60 && short.duration < 120);
  assert.equal(short.parts[0].label, 'Run: Prologue');
});

// A tape with each step's start time.
const timeline = (tape) => {
  let t = 0;
  return tape.steps.map((s) => ({ ...s, at: (t += s.dur) - s.dur }));
};

test('a new beat on a walk is taught as a sprint teaches one: each line heard twice, then the beat run, and its second run after the next beat', () => {
  const { app, manifest } = walkApp();
  const tape = walk(app, manifest, 3600);
  const [a, b] = [app.model.beats[2].itemIds, app.model.beats[3].itemIds]; // today's beat and a head start
  assert.ok(!tape.trials.some((tr) => tr.queue === 'new'), 'no recall straight after hearing a line');
  assert.deepEqual(tape.heard.map((x) => x.id), [...a, ...b], 'every new line heard, in script order');
  const timed = timeline(tape);
  const runs = (ids) => tape.trials.filter((tr) => ids.includes(tr.id) && tr.queue === 'beat');
  for (const ids of [a, b]) {
    const trials = runs(ids);
    assert.deepEqual(trials.map((tr) => tr.id), [...ids, ...ids], 'two runs of the beat, each in script order');
    assert.ok(trials[0].start > tape.heard.find((x) => x.id === ids.at(-1)).at, 'the first recall comes once the whole beat is heard');
    for (const id of ids) {
      const first = trials.find((tr) => tr.id === id);
      assert.equal(timed.filter((s) => s.clip === manifest.items[id].line.file && s.at < first.start).length, 2, 'each line heard twice before it is first recalled');
    }
  }
  // The beat opens with its first line's cue, and its second run waits until the next beat has run once.
  const opening = timed.findIndex((s) => s.clip === manifest.items[a[0]].line.file);
  assert.ok(timed.slice(opening - 2, opening).some((s) => s.clip === manifest.items[a[0]].cue.file));
  assert.ok(runs(a)[a.length].start > runs(b)[0].start);
  assert.ok(runs(b)[b.length].start > runs(a)[a.length].start);
});

test('a walk of any length teaches a beat whole, both runs, or leaves it for another time, and keeps to the length asked', () => {
  const { app, manifest } = walkApp();
  for (const seconds of [120, 300, 480, 600, 900, 1200, 1800]) {
    const tape = walk(app, manifest, seconds);
    for (const { id } of tape.heard) assert.equal(tape.trials.filter((tr) => tr.id === id && tr.queue === 'beat').length, 2, `${seconds} s: both runs of every line taught`);
    assert.ok(tape.duration <= seconds + 30, `${seconds} s: ${Math.round(tape.duration)} s long`);
  }
  // On a first walk, with nothing to check, the first beat is taught even if it runs over.
  const fresh = fakeApp();
  const first = buildWalk({ model: fresh.model, index: fresh.index, manifest: readAudioPack(buildFixturePack(fresh.model)).manifest, getState: fresh.getState, settings: fresh.settings, plan: fresh.plan(), start: fresh.clock, seconds: 60 });
  assert.deepEqual(first.heard.map((x) => x.id), fresh.model.beats[0].itemIds);
  assert.equal(first.trials.length, 2 * fresh.model.beats[0].itemIds.length);
});

test('after a walk its results are saved at the moments heard, and a later walk brings the new lines back', () => {
  const { app, manifest } = walkApp();
  const tape = walk(app, manifest, 3600);
  const records = walkRecords(walkResults(tape, reviewRows(tape, new Set()), new Set()), { start: app.clock, getState: app.getState });
  records.forEach((rec) => app.save(rec));
  assert.equal(records[0].event.time, app.clock + tape.trials[0].answerEnd * 1000);
  // Each answer carries the seconds of tape since the answer before, new lines heard in between
  // included, so Practised today counts the whole walk.
  assert.equal(records[0].event.active, Math.round(tape.trials[0].answerEnd * 10) / 10);
  const total = records.reduce((n, rec) => n + rec.event.active, 0);
  assert.ok(Math.abs(total - tape.trials.at(-1).answerEnd) < 1, `${total} against ${tape.trials.at(-1).answerEnd}`);
  const newIds = [...app.model.beats[2].itemIds, ...app.model.beats[3].itemIds]; // today's beat and a head start
  assert.ok(newIds.every((id) => app.getState(id).status === 'review'));
  app.wait(90);
  const later = walk(app, manifest, 3600);
  assert.ok(newIds.includes(later.trials[0].id), 'an hour and a half on, the new lines come back first');
  const order = later.parts.map((p) => p.label);
  for (const scene of ['Run: Scene 1: The Harbour', 'Run: Scene 3: Landfall']) assert.ok(order.indexOf(scene) < order.indexOf('Run: Prologue'), 'the scenes with new lines, more at risk, before the Prologue');
});

test('marking: a tap in the two seconds after an answer marks that answer', () => {
  const trials = [{ start: 0, answerEnd: 5, end: 7 }, { start: 5.3, answerEnd: 10, end: 12 }];
  assert.equal(trialAt(trials, 4), 0);
  assert.equal(trialAt(trials, 6), 0);
  assert.equal(trialAt(trials, 8), 1);
  assert.equal(trialAt(trials, 20), -1);
  assert.equal(partAt([{ label: 'Check', start: 0 }, { label: 'Run: Prologue', start: 30 }], 31), 'Run: Prologue');
});

test('review and results: ticks become misses, everything else passes, unheard lines are left out', () => {
  const tape = { trials: [{ id: 'a', queue: 'run', answerEnd: 5 }, { id: 'b', queue: 'run', answerEnd: 10 }, { id: 'a', queue: 'beat', answerEnd: 15 }, { id: 'c', queue: 'run', answerEnd: 30 }] };
  const marked = new Set([1]);
  const rows = reviewRows(tape, marked, 20);
  assert.deepEqual(rows.map((r) => [r.id, r.ticked]), [['a', false], ['b', true]]);
  rows[0].ticked = true; // ticked in the review with no mark: its last trial is the miss
  assert.deepEqual(walkResults(tape, rows, marked), [
    { trial: 0, id: 'a', queue: 'run', pass: true, at: 5, tapeAt: 5 },
    { trial: 1, id: 'b', queue: 'run', pass: false, at: 10, tapeAt: 10 },
    { trial: 2, id: 'a', queue: 'beat', pass: false, at: 15, tapeAt: 15 },
  ]);
});

test('a pack from another script: lines without clips are skipped and counted', () => {
  const app = fakeApp();
  const { manifest } = readAudioPack(buildFixturePack(app.model, { skip: 2 }));
  const tape = walk(app, manifest, 3600);
  assert.equal(tape.missing, 2);
  assert.ok(tape.trials.length > 0);
});

test('a cue made longer plays the lines before it from the pack; a new beat opens with its usual cue', () => {
  const app = fakeApp();
  const { manifest } = readAudioPack(buildFixturePack(app.model));
  const ids = app.model.scenes[1].itemIds;
  const [first, second] = app.model.beats[0].itemIds; // the first new beat on the tape
  for (const [id, lead] of [[ids[3], [ids[1], ids[2]]], [second, [first]]]) app.index.cues.set(id, { ...app.index.byId.get(id).cue, lead, lines: [] });
  learn(app, [ids[3]], { stability: 24, hoursAgo: 48 });
  const tape = walk(app, manifest, 3600);
  let t = 0;
  const timed = tape.steps.map((s) => ({ ...s, at: (t += s.dur) - s.dur }));
  const before = (trial) => timed.filter((s) => s.clip && s.at >= trial.replayFrom - 1e-9 && s.at < trial.start - 1e-9).map((s) => s.clip);
  assert.equal(tape.parts[0].label, 'Check');
  const check = tape.trials.find((tr) => tr.id === ids[3]);
  const clips = (id) => manifest.items[id];
  assert.deepEqual(before(check), [clips(ids[1]).cue.file, clips(ids[1]).line.file, clips(ids[2]).line.file]);
  // The new beat opens with the start of the Prologue, and in its runs the second line follows the
  // first with no cue of its own.
  const timed2 = timeline(tape);
  const opening = timed2.findIndex((s) => s.clip === clips(first).line.file);
  assert.ok(timed2.slice(opening - 2, opening).some((s) => s.clip === manifest.headings[0].file));
  for (const tr of tape.trials.filter((x) => x.id === second)) assert.deepEqual(before(tr), []);
});
