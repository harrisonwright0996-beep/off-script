import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeApp, learn } from './helpers.mjs';
import { phaseOf, recallGate, dayOrder, beatStage, untilText, paceOf, buildPlan, FRONT_LOAD } from '../src/plan.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';
import { newState } from '../src/state.js';
import { HOUR } from '../src/memory.js';

const sceneIds = (app, i) => app.model.scenes[i].itemIds;
const beatIds = (app, i) => app.model.beats[i].itemIds;
const allIds = (app) => app.model.items.map((i) => i.id);

test('phases follow the dates', () => {
  const s = DEFAULT_SETTINGS;
  assert.equal(phaseOf('2026-10-26', s), 'learning');
  assert.equal(phaseOf('2026-11-01', s), 'learning');
  assert.equal(phaseOf('2026-11-02', s), 'final');
  assert.equal(phaseOf('2026-11-03', s), 'final');
  assert.equal(phaseOf('2026-11-04', s), 'deadline');
  assert.equal(phaseOf('2026-11-05', s), 'maintenance');
  assert.equal(phaseOf('2026-12-10', s), 'maintenance');
  assert.equal(phaseOf('2026-12-11', s), 'final', 'the three days before show week are final days again');
  assert.equal(phaseOf('2026-12-13', s), 'final');
  assert.equal(phaseOf('2026-12-14', s), 'show');
  assert.equal(phaseOf('2026-12-20', s), 'show');
  assert.equal(phaseOf('2026-12-21', s), 'maintenance');
});

test('quota: a little more than an even spread of the new words over the days left, all of it on the last day', () => {
  const app = fakeApp(); // 26 Oct to 1 Nov is 7 days
  const plan = app.plan();
  assert.equal(FRONT_LOAD, 1.25);
  assert.equal(plan.quota, Math.ceil((143 * 1.25) / 7));
  assert.deepEqual([plan.tests.length, plan.done], [0, false]);
  app.setDay('2026-11-01');
  assert.equal(app.plan().quota, 143, 'last new day: everything left');
});

test('missed days rebalance quietly: the quota grows, a neutral note, no blame', () => {
  const app = fakeApp();
  learn(app, beatIds(app, 0), { hoursAgo: 0 });
  app.setDay('2026-10-30');
  const plan = app.plan();
  assert.equal(plan.quota, Math.ceil(((143 - app.model.beats[0].words) * 1.25) / 3));
  assert.ok(plan.notes.includes('Welcome back. The plan has been rebalanced around today.'));
});

test('words started today count against the quota', () => {
  const app = fakeApp();
  const b0 = app.model.beats[0];
  for (const id of b0.itemIds) app.states.set(id, { ...newState(id), status: 'learning', firstDay: '2026-10-26', passes: 1, stability: 1 / 6, passDays: ['2026-10-26'], lastResult: 'pass', lastDay: '2026-10-26', lastTime: app.clock });
  assert.deepEqual(app.plan().newBeats, [b0.id], 'the beat in progress, and nothing new because the quota is used');
});

test('Learn this scene next puts that scene first', () => {
  const app = fakeApp({ settings: { focusScene: 3 } });
  assert.equal(app.index.beatById.get(app.plan().newBeats[0]).scene, 3);
});

// Checks of learned lines yesterday, each made when the curve expected 90%.
function checks(app, n, passes, extra = {}) {
  const t0 = app.clock - 30 * HOUR;
  for (let i = 0; i < n; i++) {
    const time = t0 + i * 60000;
    app.events.push({ time, day: '2026-10-25', id: 'x' + (i % 20), queue: i % 2 ? 'run' : 'due', mode: 'type', pass: i < passes, prev: { status: 'review', stability: 24, lastTime: time - 24 * HOUR }, ...extra });
  }
}

test('the gate: recent checks against what the curve expected; a few points short is bad luck, more cuts new lines gently, at most by half', () => {
  const even = Math.ceil((143 * 1.25) / 7);
  // The plan with the curve as it stands (his personal factor not yet moved).
  const planOf = (app) => buildPlan({ model: app.model, index: app.index, getState: app.getState, events: app.events, settings: app.settings, today: app.today, now: app.clock, fit: { k: 1, n: 0 } });
  let app = fakeApp();
  checks(app, 100, 88);
  let gate = recallGate(app.events, { k: 1 });
  assert.deepEqual([gate.total, gate.passes, Math.round(gate.expected), gate.factor], [100, 88, 90, 1], '2 points short: nothing changes');
  assert.equal(planOf(app).quota, even);
  assert.equal(planOf(app).notes.length, 0);

  app = fakeApp();
  checks(app, 100, 82);
  gate = recallGate(app.events, { k: 1 });
  assert.ok(Math.abs(gate.factor - 0.75) < 1e-9, '8 points short: a quarter less');
  const plan = planOf(app);
  assert.equal(plan.quota, Math.ceil(even * gate.factor));
  assert.equal(plan.notes[0], 'Your last 100 checks had 82 word perfect, where your forgetting curve expected about 90. So today has about 25% fewer new lines, and more time for what you know.');
  const fitted = app.plan();
  assert.equal(fitted.quota, even, 'once his curve is fitted to the same checks it expects fewer, so nothing is cut');
  assert.ok(fitted.notes.includes('Your lines are slipping a little sooner than expected, so checks come round sooner.'), 'checks come sooner instead');

  app = fakeApp();
  checks(app, 100, 60);
  assert.equal(recallGate(app.events, { k: 1 }).factor, 0.5, 'never less than half');

  app = fakeApp();
  checks(app, 39, 20);
  assert.equal(recallGate(app.events, { k: 1 }).factor, 1, 'needs at least 40 checks');

  app = fakeApp();
  checks(app, 100, 60, { mode: 'walk' });
  assert.equal(recallGate(app.events, { k: 1 }).total, 0, 'walks are left out: marked from memory afterwards');
  checks(app, 100, 60, { prev: { status: 'learning', stability: 1, lastTime: app.clock - HOUR } });
  assert.equal(recallGate(app.events, { k: 1 }).total, 0, 'only lines already learned count');
  checks(app, 100, 60);
  assert.equal(recallGate(app.events, { before: app.clock - 40 * HOUR, k: 1 }).total, 0, 'only checks before today count');
});

test('a learned line is ready once its chance of recall falls to 90%, a scene opening at 95%', () => {
  const app = fakeApp();
  const [opening, second] = sceneIds(app, 1);
  learn(app, sceneIds(app, 1), { stability: 2, hoursAgo: 1.5 });
  let plan = app.plan();
  assert.deepEqual(plan.due, [opening], 'the opening falls to 95% after 55 minutes; the rest are still above 90%');
  assert.ok(Math.abs(plan.nextAt - (app.getState(second).lastTime + 2 * HOUR)) < 1000, 'the next is ready two hours after its last test');
  app.wait(31);
  plan = app.plan();
  assert.deepEqual([plan.runs.length, plan.due.length], [1, 0], 'now the whole scene is ready, so it is run in flow');
});

test('a line missed and not yet relearned is ready at once, and comes first', () => {
  const app = fakeApp();
  learn(app, sceneIds(app, 3), { stability: 1, hoursAgo: 3 });
  const missed = sceneIds(app, 1)[2];
  learn(app, [missed], { stability: 100, hoursAgo: 0.1, lastResult: 'miss' });
  const plan = app.plan();
  assert.deepEqual(plan.tests[0], { kind: 'line', id: missed, r: 0 });
  assert.equal(plan.tests[1].kind, 'run');
  assert.equal(plan.tests[1].scene, 3);
});

test('a stretch of ready lines runs in flow; scattered ready lines are tested on their own', () => {
  const app = fakeApp();
  const [b1, b2] = [beatIds(app, 1), beatIds(app, 2)];
  const strong = (ids) => learn(app, ids, { stability: 48, hoursAgo: 1 });
  strong([...b1, ...b2]);
  learn(app, b2.slice(0, 5), { stability: 2, hoursAgo: 4 });
  learn(app, [b2[5]], { stability: 2, hoursAgo: 8 }); // the weakest
  let plan = app.plan();
  assert.equal(plan.runs.length, 1);
  assert.deepEqual(plan.runs[0].itemIds, b2.slice(0, 6), 'just the stretch that needs it, from its first ready line');
  assert.ok(Math.abs(plan.runs[0].r - (1 + (19 / 81) * 4) ** -0.5) < 1e-9, 'as at risk as its weakest line');
  strong([b2[2], b2[5]]); // one line in the middle no longer ready: still one stretch
  plan = app.plan();
  assert.deepEqual(plan.runs.map((r) => r.itemIds), [b2.slice(0, 5)]);
  strong(b2);
  learn(app, [b1[0], b2[0], b2[3], b2[6]], { stability: 2, hoursAgo: 4 }); // scattered
  plan = app.plan();
  assert.equal(plan.runs.length, 0);
  assert.equal(plan.due.length, 4);
});

test('tests come most at risk first', () => {
  const app = fakeApp();
  const ids = sceneIds(app, 1);
  learn(app, ids, { stability: 48, hoursAgo: 1 });
  learn(app, [ids[4]], { stability: 1, hoursAgo: 2 });
  learn(app, [ids[8]], { stability: 1, hoursAgo: 6 });
  learn(app, [ids[11]], { stability: 1, hoursAgo: 4 });
  assert.deepEqual(app.plan().due, [ids[8], ids[11], ids[4]]);
});

test('lines of equal risk keep the same shuffled order all day', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.deepEqual(dayOrder(ids, '2026-10-27'), dayOrder([...ids].reverse(), '2026-10-27'));
  assert.notDeepEqual(dayOrder(ids, '2026-10-27'), dayOrder(ids, '2026-10-28'));
});

test('while learning, nothing goes more than three days untested, however strong', () => {
  const app = fakeApp();
  const id = sceneIds(app, 1)[3];
  learn(app, [id], { stability: 1000, hoursAgo: 48 });
  assert.equal(app.plan().due.length, 0);
  learn(app, [id], { stability: 1000, hoursAgo: 72 });
  assert.deepEqual(app.plan().due, [id]);
});

test('final days: every line every day, whole scenes from the top, the weakest scene first', () => {
  const app = fakeApp();
  app.setDay('2026-11-03');
  learn(app, allIds(app), { stability: 500, hoursAgo: 20 });
  const plan = app.plan();
  assert.equal(plan.phase, 'final');
  assert.deepEqual(plan.runs.map((r) => r.scene), [0, 1, 3]);
  assert.deepEqual(plan.runs[1].itemIds, sceneIds(app, 1));
  assert.ok(plan.notes.includes('Final days: every learned line every day, whole scenes from the top, the weakest first.'));
  assert.ok(plan.notes.includes('Today, do at least one whole run in Type or Say mode. It is the precise check.'));
  assert.equal(plan.newBeats.length, 0);
  learn(app, [sceneIds(app, 3)[2]], { stability: 30, hoursAgo: 20 }); // one weaker line in Scene 3
  learn(app, [sceneIds(app, 1)[5]], { stability: 100, hoursAgo: 20 }); // and a slightly weaker one in Scene 1
  assert.deepEqual(app.plan().runs.map((r) => r.scene), [3, 1, 0], 'the scene with the weakest line first');
  learn(app, [sceneIds(app, 0)[1]], { stability: 500, hoursAgo: 20, lastResult: 'miss' });
  assert.deepEqual(app.plan().runs.map((r) => r.scene), [0, 3, 1], 'a scene with a miss before them all');
  learn(app, allIds(app), { stability: 500, hoursAgo: 1 });
  assert.equal(app.plan().tests.length, 0, 'once run today, done until tomorrow');
});

test('December: the three days before show week are final days again, then show week checks every three days at most', () => {
  const app = fakeApp();
  app.setDay('2026-12-11');
  learn(app, allIds(app), { stability: 2000, hoursAgo: 20 });
  let plan = app.plan();
  assert.equal(plan.phase, 'final');
  assert.equal(plan.runs.length, 3, 'every scene run whole, however strong');
  assert.ok(!plan.notes.includes('Today, do at least one whole run in Type or Say mode. It is the precise check.'));
  app.setDay('2026-12-13');
  learn(app, allIds(app), { stability: 2000, hoursAgo: 20 });
  assert.ok(app.plan().notes.includes('Today, do at least one whole run in Type or Say mode. It is the precise check.'), 'the day before show week');
  app.setDay('2026-12-16');
  learn(app, allIds(app), { stability: 2000, hoursAgo: 24 * 2 });
  plan = app.plan();
  assert.equal(plan.phase, 'show');
  assert.equal(plan.tests.length, 0);
  assert.ok(plan.notes.includes('Show week. Short checks keep every line at its peak; anything missed comes first next time.'));
  learn(app, allIds(app), { stability: 2000, hoursAgo: 24 * 3 });
  assert.equal(app.plan().runs.length, 3, 'three days untested: checked again');
});

test('after off script day, strong lines can go up to two weeks', () => {
  const app = fakeApp();
  app.setDay('2026-11-20');
  learn(app, allIds(app), { stability: 2000, hoursAgo: 24 * 13 });
  assert.equal(app.plan().phase, 'maintenance');
  assert.equal(app.plan().tests.length, 0);
  learn(app, allIds(app), { stability: 2000, hoursAgo: 24 * 14 });
  assert.equal(app.plan().runs.length, 3);
});

test('when his lines last longer than expected, checks spread out, and the plan says so', () => {
  const app = fakeApp();
  const prev = { status: 'review', stability: 1, lastTime: app.clock - 50 * HOUR };
  for (let i = 0; i < 60; i++) app.events.push({ time: app.clock - 40 * HOUR, day: '2026-10-24', id: 'x', pass: true, mode: 'type', queue: 'due', prev });
  learn(app, [sceneIds(app, 1)[3]], { stability: 2, hoursAgo: 2.5 });
  const plan = app.plan();
  assert.ok(plan.k > 1.25, `k = ${plan.k}`);
  assert.ok(plan.notes.includes('Your lines are lasting longer than expected, so checks are spaced further apart.'));
  assert.equal(plan.due.length, 0, 'not ready yet for him, though the plain curve would say so');
});

test('forecast, estimate and the next check are plain and kind', () => {
  const app = fakeApp();
  const plan = app.plan();
  assert.match(plan.forecast, /^To start every scene by Sunday, aim for about 26 new words today: about \d+ minutes at a typical pace\.$/);
  assert.ok(plan.estimate.low >= 5 && plan.estimate.high >= plan.estimate.low);
  learn(app, allIds(app), { stability: 48, hoursAgo: 1 });
  const after = app.plan();
  assert.equal(after.forecast, 'Every speech is learned. Checks and runs keep it word perfect.');
  assert.equal(after.done, true);
  assert.equal(untilText(after.nextAt, app.clock, app.today), 'tomorrow');
  assert.equal(untilText(app.clock + 23 * 60000, app.clock, app.today), 'in about 25 minutes');
  assert.equal(untilText(app.clock + 2 * HOUR, app.clock, app.today), 'in about 2 hours');
});

test('progress: words by colour and speeches word perfect per scene', () => {
  const app = fakeApp();
  learn(app, sceneIds(app, 3), { hoursAgo: 0 });
  const p = app.plan().progress;
  const sc3 = p.scenes[3];
  assert.equal(sc3.seg.perfect, app.model.scenes[3].words);
  assert.equal(sc3.perfectSpeeches, sc3.speeches);
  assert.equal(p.perfectWords, app.model.scenes[3].words);
  assert.equal(p.totalWords, 143);
});

test('beat stages', () => {
  const app = fakeApp();
  const b = app.model.beats[0];
  assert.equal(beatStage(b, app.getState), 'learn');
  for (const id of b.itemIds) app.states.set(id, { ...newState(id), status: 'learning', passes: 1 });
  assert.equal(beatStage(b, app.getState), 'run');
  app.states.set(b.itemIds[2], { ...newState(b.itemIds[2]), status: 'learning', misses: 1 });
  assert.equal(beatStage(b, app.getState), 'learn', 'a line missed and never yet right is still to be taught');
  app.states.set(b.itemIds[2], { ...newState(b.itemIds[2]), status: 'learning', misses: 1, helped: 1 });
  assert.equal(beatStage(b, app.getState), 'run', 'right with the first letters: taught, so the beat is run');
  learn(app, b.itemIds);
  assert.equal(beatStage(b, app.getState), 'done');
});

test('the plan says which lines are ready, for the sprint to choose from', () => {
  const app = fakeApp();
  learn(app, sceneIds(app, 3), { stability: 1, hoursAgo: 3 });
  const plan = app.plan();
  assert.deepEqual([...plan.ready.keys()].sort(), [...sceneIds(app, 3)].sort());
});

test('goes with the first letters: their time counts, but only one outcome per check', () => {
  const app = fakeApp();
  const review = { status: 'review', stability: 24, lastTime: app.clock - 24 * HOUR };
  const events = [];
  const add = (extra) => events.push({ time: app.clock + events.length * 10000, day: app.today, id: app.model.items[events.length % 20].id, queue: 'due', mode: 'say', prev: review, pass: true, ...extra });
  for (let i = 0; i < 10; i++) {
    add({ help: true }); // right with the first letters: not a check of its own
    add({ primed: true, pass: i >= 2 }); // then from the cue alone: this is the check
  }
  add({ help: true, pass: false }); // missed even with the first letters: a check, missed
  add({ relearn: true, help: true });
  add({ relearn: true });
  const gate = recallGate(events);
  assert.deepEqual([gate.total, gate.passes], [11, 8], 'help passes and relearning left out; a help miss counts');
  const pace = paceOf(events, app.today, app.index.byId);
  assert.equal(pace.dueSecPerItem, (20 + 22 * 10) / 11, 'every go takes its time (20 seconds for the first, 10 for each after); 11 checks');
});
