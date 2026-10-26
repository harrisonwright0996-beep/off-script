import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBackup, readBackup, BackupError } from '../src/backup.js';
import { fakeApp, learn } from './helpers.mjs';

test('a backup holds ids and results only, and restores onto the same script', () => {
  const app = fakeApp();
  const ids = app.model.scenes[1].itemIds;
  learn(app, ids, { stability: 5 });
  const prev = { ...app.getState(ids[0]), passDays: ['x'], missDays: [] };
  app.events.push({ key: 7, time: 1, day: '2026-10-26', id: ids[0], pass: true, mode: 'type', queue: 'due', prev });
  const data = makeBackup({ model: app.model, states: app.states.values(), events: app.events, settings: app.settings, now: 42 });
  const text = JSON.stringify(data);
  for (const it of app.model.items) assert.ok(!text.includes(it.text), 'no line text in a backup');
  assert.deepEqual(data.events[0].prev, { status: 'review', stability: 5, lastTime: prev.lastTime });
  assert.equal('key' in data.events[0], false);
  const back = readBackup(text, app.model);
  assert.deepEqual([back.kept, back.dropped, back.sameScript, back.made], [ids.length, 0, true, 42]);
  assert.deepEqual(back.states.find((s) => s.id === ids[2]), app.getState(ids[2]));
  assert.equal(back.settings.deadline, '2026-11-04');
});

test('a backup from another version of the script keeps the lines still in it', () => {
  const app = fakeApp();
  learn(app, app.model.scenes[0].itemIds);
  const data = makeBackup({ model: app.model, states: [...app.states.values(), { id: 'gone', status: 'review' }], events: [], settings: app.settings });
  data.scriptHash = 'other';
  const back = readBackup(JSON.stringify(data), app.model);
  assert.deepEqual([back.kept, back.dropped, back.sameScript], [4, 1, false]);
});

test('files that are not backups are refused plainly', () => {
  const app = fakeApp();
  const code = (text) => {
    try {
      readBackup(text, app.model);
    } catch (e) {
      assert.ok(e instanceof BackupError);
      return e.code;
    }
  };
  assert.equal(code('not json'), 'not-json');
  assert.equal(code('{"app":"other"}'), 'not-backup');
  assert.equal(code('{"app":"off-script","version":9,"states":[],"events":[]}'), 'newer');
});
