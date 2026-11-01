import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeApp, fixtureModel } from './helpers.mjs';
import { createSession, CUE_EVERY } from '../src/session.js';
import { cueChoices } from '../src/items.js';
import { makeResult } from '../src/grade.js';

const start = (app, opts = {}) => createSession({ model: app.model, index: app.index, getPlan: app.plan, getState: app.getState, settings: app.settings, now: app.now, ...opts });

// The last day for new lines, so a sprint goes through the whole play.
const quiz = (extra = {}) => fakeApp({ today: '2026-11-01', settings: { cueQuiz: true, cueEvery: 2, ...extra } });

const answer = (app, s) => app.save(s.answer(makeResult({ misses: [], mode: s.card && ['help', 'gaps'].includes(s.card.step) ? 'say' : 'type' })));

// Answers everything right until a cue card comes, or `max` cards go by.
function untilCue(app, s, max = 200) {
  let card = s.card || s.advance();
  for (let i = 0; card && i < max; i++) {
    if (card.step === 'cue') return card;
    if (card.step === 'test') card = s.choose('try');
    else if (card.step === 'front') card = s.choose('next');
    else {
      answer(app, s);
      card = s.advance();
    }
  }
  return null;
}

test('a cue question has three different cues, the real one among them, in an order that gives nothing away', () => {
  const { model } = fixtureModel();
  const item = model.items[5];
  const q = cueChoices(model, item, 'a');
  assert.equal(q.options.length, 3);
  assert.equal(new Set(q.options).size, 3);
  assert.equal(q.options[q.right], item.cue.text);
  const places = new Set();
  for (let turn = 0; turn < 40; turn++) places.add(cueChoices(model, item, turn).right);
  assert.ok(places.size > 1, 'the right answer moves about');
  assert.deepEqual(cueChoices(model, item, 'a'), q, 'the same each time, so a card carried on later is the same card');
});

test('a cue question takes its wrong answers from the cues nearest in the same scene', () => {
  const item = (index, scene) => ({ id: `i${index}`, index, scene, speaker: 'A', text: `line ${index}`, cue: { speaker: 'B', text: `Cue ${index}.`, notes: [] } });
  const items = [...Array(12).keys()].map((i) => item(i + 1, 0)).concat([31, 33, 35].map((n) => item(n, 1)));
  const nearest = new Set([3, 4, 5, 6, 7, 8, 9, 10, 2].map((n) => `Cue ${n}.`));
  for (let turn = 0; turn < 30; turn++) assert.ok(cueChoices({ items }, items[5], turn).options.every((o) => nearest.has(o)));
});

test('the end of the line on show is never offered: it is the cue of the line after it', () => {
  const { model } = fixtureModel();
  model.items.forEach((item, i) => {
    const after = model.items[i + 1];
    if (!after || after.cue.speaker === null) return;
    for (let turn = 0; turn < 12; turn++) {
      const q = cueChoices(model, item, turn);
      if (q) assert.ok(!q.options.includes(after.cue.text) || after.cue.text === item.cue.text);
    }
  });
});

test('no cue question for the first line of a scene, or with too few wrong answers', () => {
  const { model } = fixtureModel();
  const opening = model.items.find((it) => it.cue.speaker === null);
  assert.equal(cueChoices(model, opening, 'a'), null);
  assert.equal(cueChoices({ ...model, items: model.items.slice(1, 3) }, model.items[2], 'a'), null);
});

test('a line said twice has two right cues, so neither is offered as a wrong answer', () => {
  const item = (index, cue, text = `line ${index}`) => ({ id: `i${index}`, index, scene: 0, speaker: 'A', text, cue: { speaker: 'B', text: cue, notes: [] } });
  const items = [item(1, 'First cue.', 'Yes.'), item(3, 'Second cue.', 'Yes!'), item(5, 'Third cue.'), item(7, 'Fourth cue.'), item(9, 'Fifth cue.')];
  for (let turn = 0; turn < 30; turn++) {
    const q = cueChoices({ items }, items[0], turn);
    assert.ok(!q.options.includes('Second cue.'));
    assert.equal(q.options[q.right], 'First cue.');
  }
});

test('a cue card asks about a line already right in this sprint, with its cue among the choices, and changes nothing', () => {
  const app = quiz();
  const s = start(app);
  const c = untilCue(app, s);
  assert.ok(c, 'one comes up');
  assert.equal(c.choices.length, 3);
  assert.equal(c.choices[c.right], c.item.cue.text);
  assert.equal(s.state.lines[c.item.id].need, 'done');
  const before = JSON.stringify(app.getState(c.item.id));
  const goes = s.state.goes;
  assert.deepEqual(s.cueAnswer(true), { later: false });
  assert.equal(JSON.stringify(app.getState(c.item.id)), before);
  assert.equal(s.state.goes, goes, 'it does not take the place of a go at a line');
  assert.notEqual(s.advance()?.step, 'cue', 'never two in a row');
});

test('cue cards come about every so many answers, and a line right is not asked again that sprint', () => {
  const app = quiz({ cueEvery: CUE_EVERY });
  const s = start(app);
  const asked = [];
  let answers = 0;
  let card = s.advance();
  for (let i = 0; card && i < 300; i++) {
    if (card.step === 'cue') {
      asked.push(card.item.id);
      assert.ok(answers >= CUE_EVERY, 'not before its turn');
      answers = 0;
      s.cueAnswer(true);
      card = s.advance();
    } else if (card.step === 'test') card = s.choose('try');
    else if (card.step === 'front') card = s.choose('next');
    else {
      answer(app, s);
      answers += 1;
      card = s.advance();
    }
  }
  assert.ok(asked.length >= 1);
  assert.equal(new Set(asked).size, asked.length);
});

test('a cue missed comes back once, and only once', () => {
  const app = quiz();
  const s = start(app);
  const first = untilCue(app, s);
  assert.deepEqual(s.cueAnswer(false), { later: true });
  s.advance();
  const second = untilCue(app, s);
  assert.equal(second.item.id, first.item.id);
  assert.deepEqual(s.cueAnswer(false), { later: false });
  s.advance();
  const third = untilCue(app, s);
  if (third) assert.notEqual(third.item.id, first.item.id);
});

test('no cue card in a chosen practice or once time is up', () => {
  const app = quiz();
  const custom = { scene: 0, itemIds: app.model.items.slice(0, 12).map((it) => it.id), help: 'cue' };
  assert.equal(untilCue(app, start(app, { custom })), null);
  const other = quiz();
  const s = start(other);
  untilCue(other, s);
  s.close();
  assert.equal(s.advance()?.step === 'cue', false, 'the card on show goes');
  assert.equal(untilCue(other, s), null);
});

test('with the question turned off no cue card comes', () => {
  const app = fakeApp({ settings: { cueQuiz: false, cueEvery: 1 } });
  assert.equal(untilCue(app, start(app)), null);
});

test('a sprint closed and carried on keeps its cue card as it was', () => {
  const app = quiz();
  const s = start(app);
  const c = untilCue(app, s);
  const back = start(app, { saved: s.save() });
  assert.equal(back.card.step, 'cue');
  assert.deepEqual([back.card.item.id, back.card.choices, back.card.right], [c.item.id, c.choices, c.right]);
});

test('a sprint saved before cue questions carries on', () => {
  const app = quiz();
  const s = start(app);
  s.advance();
  const old = s.save();
  delete old.cueGap;
  delete old.cueAsked;
  delete old.cueAgain;
  const back = start(app, { saved: old });
  assert.ok(back.card);
});
