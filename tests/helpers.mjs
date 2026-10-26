// Shared test helpers: the invented fixture play as a model, and an in memory "app"
// (states, events, plan, a clock) for driving sessions the way the real app does.
import { buildFixtureDocx } from './fixtures/night-ferry.mjs';
import { readDocxParagraphs } from '../src/docx.js';
import { parseScript } from '../src/parse.js';
import { buildModel, indexModel } from '../src/items.js';
import { newState } from '../src/state.js';
import { buildPlan } from '../src/plan.js';
import { dayKey } from '../src/dates.js';
import { HOUR } from '../src/memory.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';

export function fixtureModel() {
  const model = buildModel(parseScript(readDocxParagraphs(buildFixtureDocx())));
  return { model, index: indexModel(model) };
}

// Local time on a day key (noon unless given), so dayKey() gives that day back.
export const at = (day, hour = 12) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).getTime();

// Marks items as learned (status review, three passes), last tested `hoursAgo` before the app's
// clock, with the given stability in hours.
export function learn(app, ids, { stability = 24, hoursAgo = 24, ...extra } = {}) {
  const time = app.clock - hoursAgo * HOUR;
  const day = dayKey(new Date(time));
  for (const id of ids) {
    app.states.set(id, {
      ...newState(id),
      status: 'review',
      firstDay: day,
      learnedDay: day,
      passes: 3,
      passDays: [day],
      stability,
      lastResult: 'pass',
      lastDay: day,
      lastTime: time,
      ...extra,
    });
  }
}

export function fakeApp({ settings = {}, today = '2026-10-26', hour = 12, step = 10000 } = {}) {
  const { model, index } = fixtureModel();
  const states = new Map();
  const events = [];
  const app = {
    model,
    index,
    states,
    events,
    clock: at(today, hour),
    get today() {
      return dayKey(new Date(app.clock));
    },
    settings: { ...DEFAULT_SETTINGS, ...settings },
    getState: (id) => states.get(id) || newState(id),
    plan: () => buildPlan({ model, index, getState: app.getState, events, settings: app.settings, today: app.today, now: app.clock }),
    save({ event, state }) {
      states.set(state.id, state);
      events.push(event);
    },
    undo() {
      const ev = events.pop();
      states.set(ev.id, ev.prev);
    },
    setDay(day, h = 12) {
      app.clock = at(day, h);
    },
    wait(minutes) {
      app.clock += minutes * 60000;
    },
    now: () => (app.clock += step), // each answer takes `step` ms
  };
  return app;
}
