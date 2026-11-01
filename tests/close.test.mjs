import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeApp, learn } from './helpers.mjs';
import { createSession } from '../src/session.js';
import { CLOSE_WORDS, describeResult, makeResult } from '../src/grade.js';
import { fitFactor } from '../src/memory.js';
import { applyResult, isWordPerfect, isSecure, category, newState } from '../src/state.js';

const start = (app, opts = {}) => createSession({ model: app.model, index: app.index, getPlan: app.plan, getState: app.getState, settings: app.settings, now: app.now, ...opts });

// Learned a week ago and right on three days since: checked from the cue alone first.
const REVIEW = { status: 'review', passes: 8, helped: 3, stability: 24, hoursAgo: 30, firstDay: '2026-10-20', learnedDay: '2026-10-20', passDays: ['2026-10-21', '2026-10-22', '2026-10-23'], lastResult: 'pass' };

// Every card a check of the long line: anything else asked first is answered right.
function atLongLine(app, it, extra = {}) {
  learn(app, [it.id], { ...REVIEW, ...extra });
  const s = start(app, { scope: 'tests' });
  let c = s.advance();
  while (c.item.id !== it.id || c.step !== 'floor') {
    app.save(s.answer(makeResult({ misses: [], mode: 'say' })));
    c = s.advance();
  }
  return { s, c };
}

const longLine = (app) => app.model.items.find((x) => x.words >= CLOSE_WORDS);

test('one word out of a long line passes, and only when the length is given', () => {
  assert.equal(makeResult({ misses: [2], mode: 'type', words: CLOSE_WORDS }).pass, true);
  assert.equal(makeResult({ misses: [2], mode: 'type', words: CLOSE_WORDS - 1 }).pass, false);
  assert.equal(makeResult({ misses: [2], mode: 'type' }).pass, false);
  assert.equal(makeResult({ misses: [2, 3], mode: 'type', words: 40 }).pass, false);
});

test('the wrong speaker fails a long line, whatever the words', () => {
  assert.equal(makeResult({ misses: [2], speakerWrong: true, mode: 'type', words: 40 }).pass, false);
  assert.equal(makeResult({ misses: [], speakerWrong: true, mode: 'type', words: 40 }).pass, false);
});

test('a close line says which word to watch', () => {
  const tokens = [{ d: 'Keep', k: 'k' }, { d: 'the', k: 't' }, { d: 'lamp,', k: 'l' }];
  const r = makeResult({ misses: [2], mode: 'type', words: 8 });
  assert.equal(describeResult(r, tokens, 'Keeper'), 'Nearly word perfect. Watch out for: lamp');
});

test('a card lets a close line pass only for a line already learned', () => {
  const app = fakeApp({ today: '2026-10-27' });
  const it = longLine(app);
  const { c } = atLongLine(app, it);
  assert.equal(c.close, true);
  const fresh = fakeApp({ today: '2026-10-27' });
  assert.ok(!start(fresh).advance().close);
  const off = fakeApp({ today: '2026-10-27', settings: { closeLines: false } });
  assert.equal(atLongLine(off, longLine(off)).c.close, false);
});

test('while a line is still being learned every word counts', () => {
  const app = fakeApp({ today: '2026-10-27' });
  const it = longLine(app);
  learn(app, [it.id], { ...REVIEW, status: 'learning', passes: 1, learnedDay: null, passDays: ['2026-10-26'] });
  const s = start(app);
  let c = s.advance();
  for (let i = 0; i < 80 && (c.item.id !== it.id || c.step !== 'floor'); i++) {
    if (c.step === 'test') c = s.choose('try');
    else if (c.step === 'front') c = s.choose('next');
    else {
      app.save(s.answer(makeResult({ misses: [], mode: 'say' })));
      c = s.advance();
    }
  }
  assert.equal(c.item.id, it.id);
  assert.equal(c.step, 'floor');
  assert.equal(c.close, false);
});

test('one word out grows the line by half as much and comes back when it would have', () => {
  const app = fakeApp({ today: '2026-10-27' });
  const it = longLine(app);
  const { s } = atLongLine(app, it);
  const before = app.getState(it.id).stability;
  const rec = s.answer(makeResult({ misses: [2], mode: 'type', words: it.words }));
  app.save(rec);
  assert.equal(rec.event.pass, true);
  assert.equal(rec.event.slow, true);
  assert.equal(rec.event.misses, 1);
  assert.deepEqual(rec.event.missed, [2]);
  assert.equal(rec.state.closeWord, 2);
  assert.ok(rec.state.stability > before);

  const whole = fakeApp({ today: '2026-10-27' });
  const again = atLongLine(whole, longLine(whole));
  const full = again.s.answer(makeResult({ misses: [], mode: 'type', words: it.words }));
  assert.ok(rec.state.stability < full.state.stability);
  assert.equal(full.state.closeWord, null);
});

test('the same word wrong twice still passes, but does not grow the line, and it comes back with its letters', () => {
  const app = fakeApp({ today: '2026-10-27' });
  const it = longLine(app);
  const { s } = atLongLine(app, it, { closeWord: 2 });
  const before = app.getState(it.id).stability;
  const rec = s.answer(makeResult({ misses: [2], mode: 'type', words: it.words }));
  app.save(rec);
  assert.equal(rec.event.pass, true);
  assert.equal(rec.state.stability, before);
  assert.equal(rec.need, 'help');
  assert.equal(rec.later, true);
  assert.equal(rec.state.closeWord, 2);
});

test('a different word wrong the second time grows as a near miss', () => {
  const app = fakeApp({ today: '2026-10-27' });
  const it = longLine(app);
  const { s } = atLongLine(app, it, { closeWord: 2 });
  const before = app.getState(it.id).stability;
  const rec = s.answer(makeResult({ misses: [3], mode: 'type', words: it.words }));
  assert.ok(rec.state.stability > before);
  assert.equal(rec.state.closeWord, 3);
  assert.equal(rec.need, 'done');
});

test('a close line is not word perfect until the next whole go, on the map or for the count', () => {
  const s = { ...newState('x'), status: 'review', passes: 3, stability: 5, learnedDay: '2026-10-25', firstDay: '2026-10-25', lastTime: 1, passDays: ['2026-10-26', '2026-10-27', '2026-10-28'] };
  const close = applyResult(s, { pass: true, day: '2026-10-29', time: 1000, mode: 'type', closeWord: 4 });
  assert.equal(isWordPerfect(close), false);
  assert.equal(isSecure(close), false);
  assert.equal(category(close), 'missed');
  const whole = applyResult(close, { pass: true, day: '2026-10-30', time: 2000, mode: 'type' });
  assert.equal(whole.closeWord, null);
  assert.equal(isWordPerfect(whole), true);
  assert.equal(category(whole), 'perfect');
});

test('a word in position 0 counts as a close word too', () => {
  const s = { ...newState('x'), status: 'review', passes: 3, stability: 5, lastTime: 1, lastResult: 'pass' };
  assert.equal(isWordPerfect(applyResult(s, { pass: true, day: '2026-10-29', time: 1000, mode: 'type', closeWord: 0 })), false);
});

test('a state saved before close lines is still word perfect', () => {
  const s = { ...newState('x'), status: 'review', lastResult: 'pass' };
  delete s.closeWord;
  assert.equal(isWordPerfect(s), true);
});

test('the fit counts a close line as a miss: the schedule still aims at word perfect', () => {
  const event = (i, misses) => ({ time: 3600000 * 24 * (i + 1), mode: 'type', pass: true, misses, prev: { status: 'review', stability: 24, lastTime: 3600000 * 24 * i } });
  const whole = fitFactor(Array.from({ length: 40 }, (_, i) => event(i, 0)));
  const close = fitFactor(Array.from({ length: 40 }, (_, i) => event(i, i % 2)));
  assert.ok(close.k < whole.k);
});

test('sprint stats count only whole lines as perfect', () => {
  const app = fakeApp({ today: '2026-10-27' });
  const it = longLine(app);
  const { s } = atLongLine(app, it);
  const answered = s.stats.answered;
  const perfect = s.stats.perfect;
  app.save(s.answer(makeResult({ misses: [2], mode: 'type', words: it.words })));
  assert.equal(s.stats.answered, answered + 1);
  assert.equal(s.stats.perfect, perfect);
});

test('reading aloud lists only voices on the phone: a line never leaves it', async () => {
  const list = [
    { name: 'Local', lang: 'en-GB', localService: true, voiceURI: 'a' },
    { name: 'Cloud', lang: 'en-GB', localService: false, voiceURI: 'b' },
    { name: 'Autre', lang: 'fr-FR', localService: true, voiceURI: 'c' },
  ];
  globalThis.speechSynthesis = { getVoices: () => list, addEventListener() {}, cancel() {} };
  globalThis.SpeechSynthesisUtterance = class {};
  const { voices } = await import('../src/tts.js');
  assert.deepEqual(voices().map((v) => v.name), ['Local']);
  delete globalThis.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
});
