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
  const firstNew = tape.trials.find((t) => t.queue === 'new');
  assert.deepEqual(tape.trials.filter((t) => t.id === firstNew.id).slice(0, 3).map((t) => t.queue), ['new', 'beat', 'beat']);
  assert.ok(tape.duration < 3600, 'it stops once everything useful for now is on it');
  const scenes = tape.parts.filter((p) => p.label.startsWith('Run:')).map((p) => p.label);
  assert.ok(scenes.length <= 2 + 3, 'no scene is run over and over');
  const short = walk(app, manifest, 60);
  assert.ok(short.duration >= 60 && short.duration < 120);
  assert.equal(short.parts[0].label, 'Run: Prologue');
});

test('after a walk its results are saved at the moments heard, and a later walk brings the new lines back', () => {
  const { app, manifest } = walkApp();
  const tape = walk(app, manifest, 3600);
  const records = walkRecords(walkResults(tape, reviewRows(tape, new Set()), new Set()), { start: app.clock, getState: app.getState });
  records.forEach((rec) => app.save(rec));
  assert.equal(records[0].event.time, app.clock + tape.trials[0].answerEnd * 1000);
  const newIds = [...app.model.beats[2].itemIds, ...app.model.beats[3].itemIds]; // today's beat and a head start
  assert.ok(newIds.every((id) => app.getState(id).status === 'review'));
  app.wait(90);
  const later = walk(app, manifest, 3600);
  assert.ok(newIds.includes(later.trials[0].id), 'an hour and a half on, the new lines come back first');
  assert.equal(later.parts[0].label, 'Run: Scene 3: Landfall', 'the head start, learned last and checked least, is the most at risk');
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
    { trial: 0, id: 'a', queue: 'run', pass: true, at: 5 },
    { trial: 1, id: 'b', queue: 'run', pass: false, at: 10 },
    { trial: 2, id: 'a', queue: 'beat', pass: false, at: 15 },
  ]);
});

test('a pack from another script: lines without clips are skipped and counted', () => {
  const app = fakeApp();
  const { manifest } = readAudioPack(buildFixturePack(app.model, { skip: 2 }));
  const tape = walk(app, manifest, 3600);
  assert.equal(tape.missing, 2);
  assert.ok(tape.trials.length > 0);
});

test('a cue made longer plays the lines before it from the pack; a new line just heard keeps its usual cue', () => {
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
  const heard = tape.trials.find((tr) => tr.id === second && tr.queue === 'new');
  assert.equal(before(heard).at(-1), clips(second).cue.file);
});
