import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeApp, learn } from './helpers.mjs';
import { newState } from '../src/state.js';
import { practiceLines, practiceTitle, practiceMinutes } from '../src/practice.js';

// Learned on 20 October and right on three days since: secure.
const SECURE = { firstDay: '2026-10-20', learnedDay: '2026-10-20', passDays: ['2026-10-21', '2026-10-22', '2026-10-23'] };

test('which lines: still being learned, everything learned so far, or every line, in script order', () => {
  const app = fakeApp();
  const ids = app.model.items.map((it) => it.id);
  learn(app, [ids[0], ids[1]], SECURE);
  learn(app, [ids[2]], { hoursAgo: 2 }); // learned, not yet secure
  learn(app, [ids[5]], { ...SECURE, lastResult: 'miss' }); // was secure, missed last time
  app.states.set(ids[7], { ...newState(ids[7]), status: 'learning', firstDay: '2026-10-26', helped: 1 }); // started
  const lines = (which, scene = null) => practiceLines({ model: app.model, getState: app.getState, scene, which });
  assert.deepEqual(lines('learning'), [ids[2], ids[5], ids[7]]);
  assert.deepEqual(lines('learned'), [ids[0], ids[1], ids[2], ids[5]]);
  assert.deepEqual(lines('all'), ids);
  assert.deepEqual(lines('all', 1), app.model.scenes[1].itemIds);
  assert.deepEqual(lines('learning', 1), [ids[5], ids[7]]);
  assert.deepEqual(lines('learned', 3), []);
});

test('a choice has a plain name', () => {
  const { model } = fakeApp();
  assert.equal(practiceTitle({ model, scene: null, which: 'learned' }), 'The whole play, everything learned so far');
  assert.equal(practiceTitle({ model, scene: 1, which: 'learning' }), 'Scene 1: The Harbour, lines still being learned');
  assert.equal(practiceTitle({ model, scene: 0, which: 'all' }), 'Prologue, every line');
});

test('about how long it takes at his pace: more goes with more help, new lines at the pace of learning', () => {
  const app = fakeApp();
  const ids = app.model.scenes[3].itemIds;
  learn(app, ids, { stability: 1, hoursAgo: 3 }); // learned, not yet secure
  const pace = { newSecPerWord: 6, runSecPerWord: 1.5, dueSecPerItem: 20 };
  const wordsOf = (list) => list.reduce((n, id) => n + app.index.byId.get(id).words, 0);
  const words = wordsOf(ids);
  const mins = (help, itemIds = ids) => practiceMinutes({ index: app.index, getState: app.getState, itemIds, help, pace, now: app.clock });
  assert.equal(mins('none'), (1.5 * words) / 60, 'one go each, from the cue alone');
  assert.equal(mins('auto'), (2 * 1.5 * words) / 60, 'below 80% now: the first letters first');
  assert.equal(mins('letters'), (2 * 1.5 * words) / 60);
  assert.equal(mins('read'), (2.5 * 1.5 * words) / 60, 'reading it first adds a little more');
  learn(app, ids, { stability: 48, hoursAgo: 1 });
  assert.equal(mins('auto'), (1.5 * words) / 60, 'lines likely to be right need no help, secure or not');
  learn(app, ids, { stability: 48, hoursAgo: 1, passes: 2 });
  assert.equal(mins('auto'), (2 * 1.5 * words) / 60, 'a line right fewer than three times has them first');
  const fresh = app.model.scenes[0].itemIds;
  assert.equal(mins('auto', fresh), (6 * wordsOf(fresh)) / 60, 'lines not yet started go at the pace of learning');
});
