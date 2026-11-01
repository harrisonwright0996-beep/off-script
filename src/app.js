// Starts the app: opens storage, loads what is saved, and shows the right screen.
import { openStore } from './store.js';
import { withDefaults } from './settings.js';
import { indexModel } from './items.js';
import { newState } from './state.js';
import { buildPlan } from './plan.js';
import { fitFactor } from './memory.js';
import { dayKey, addDays } from './dates.js';
import { addSeconds, cleanStreak, creditFor, noteSlips, rebuildStreak } from './streak.js';
import { clear, focusHeading } from './ui/dom.js';
import { showInstall, needsInstall } from './ui/install.js';
import { showSetup } from './ui/setup.js';
import { showToday, showMore } from './ui/today.js';
import { showSprint } from './ui/sprint.js';
import { showScenes, showReader } from './ui/scenes.js';
import { showSettings } from './ui/settings.js';
import { showWalk } from './ui/walk.js';
import { showChoose } from './ui/choose.js';
import { showStartAgain } from './ui/again.js';
import { showBadges } from './ui/badges.js';
import { showCheckin } from './ui/checkin.js';

const SCREENS = { install: showInstall, setup: showSetup, today: showToday, sprint: showSprint, scenes: showScenes, reader: showReader, settings: showSettings, walk: showWalk, choose: showChoose, again: showStartAgain, badges: showBadges, checkin: showCheckin, more: showMore };
const EVENT_DAYS = 9; // the plan looks back this far
// A new version restarts the app on these, as it does on Today. Everywhere else something may be under
// way: a sprint, a walk, a scene read aloud, or typing.
const AT_REST = new Set(['scenes', 'choose', 'more']);

export function applyLook(s) {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.style.setProperty('--scale', String(s.textSize / 100));
  root.style.setProperty('--lh', String(s.lineSpacing));
  const spacing = { normal: ['0', '0'], wide: ['0.05em', '0.12em'], wider: ['0.1em', '0.24em'] }[s.letterSpacing] || ['0', '0'];
  root.style.setProperty('--ls', spacing[0]);
  root.style.setProperty('--ws', spacing[1]);
}

async function boot() {
  const store = await openStore();
  const ctx = {
    store,
    root: document.getElementById('app'),
    settings: withDefaults(await store.get('settings')),
    model: null,
    index: null,
    states: new Map(),
    events: [],
    eventsFrom: null,
    streak: cleanStreak(await store.get('streak')), // minutes practised, badges (streak.js)
    manifest: (await store.get('manifest')) || null,
    update: false, // a new version has taken over: it shows at the next Today
    nav: 0,
    cleanup: null,
    fit: { k: 1, n: 0 }, // his forgetting curve factor, refitted when a sprint or walk starts

    getState: (id) => ctx.states.get(id) || newState(id),
    today: () => dayKey(),

    plan() {
      const now = Date.now();
      return buildPlan({ model: ctx.model, index: ctx.index, getState: ctx.getState, events: ctx.events, settings: ctx.settings, today: dayKey(new Date(now)), now, fit: ctx.fit });
    },

    refit() {
      ctx.fit = fitFactor(ctx.events);
    },

    async refreshEvents() {
      const from = addDays(ctx.today(), -EVENT_DAYS);
      if (ctx.eventsFrom === from) return;
      ctx.events = await store.eventsSince(from);
      ctx.eventsFrom = from;
      ctx.refit();
    },

    async setModel(model, meta) {
      ctx.model = model;
      ctx.index = indexModel(model);
      await store.set('script', model);
      await store.set('scriptMeta', meta);
      await store.del('sprint');
    },

    async saveAnswer(rec) {
      rec.event.key = await store.saveAnswer(rec.event, rec.state);
      ctx.states.set(rec.state.id, rec.state);
      ctx.events.push(rec.event);
      rec.credit = creditFor(rec.event, ctx.index.byId.get(rec.event.id)?.words ?? 0);
      addSeconds(ctx.streak, rec.event.day, rec.credit);
      noteSlips(ctx.streak, rec.event.prev, rec.state);
      await ctx.saveStreak();
    },

    async undoAnswer(rec) {
      await store.undo(rec.event.key, rec.event.prev);
      ctx.states.set(rec.event.id, rec.event.prev);
      ctx.events = ctx.events.filter((e) => e !== rec.event);
      addSeconds(ctx.streak, rec.event.day, -(rec.credit || 0));
      await ctx.saveStreak();
    },

    saveStreak: () => store.set('streak', ctx.streak).catch(() => {}), // never holds up an answer

    // The record, from the answers on this phone.
    async rebuildStreak() {
      ctx.streak = rebuildStreak(await store.eventsSince('2000-01-01'), ctx.index);
      await ctx.saveStreak();
    },

    // Back to not started: these lines (every line when ids is null) lose their progress and answers.
    async startAgain(ids = null) {
      await store.clearProgress(ids);
      const gone = ids && new Set(ids);
      ctx.states = gone ? new Map([...ctx.states].filter(([id]) => !gone.has(id))) : new Map();
      ctx.events = gone ? ctx.events.filter((e) => !gone.has(e.id)) : [];
      ctx.refit();
    },

    async saveSettings(patch) {
      Object.assign(ctx.settings, patch);
      applyLook(ctx.settings);
      await store.set('settings', { ...ctx.settings });
    },

    async go(name, params = {}) {
      if (ctx.update && AT_REST.has(name)) return location.reload();
      ctx.screen = name;
      ctx.nav += 1; // lets a screen see that it was left while it waited
      if (ctx.cleanup) ctx.cleanup();
      ctx.cleanup = null;
      if (ctx.model && name !== 'install' && name !== 'setup') await ctx.refreshEvents();
      clear(ctx.root);
      const result = await SCREENS[name](ctx, params);
      if (typeof result === 'function') ctx.cleanup = result;
      window.scrollTo(0, 0);
      focusHeading(ctx.root);
    },
  };
  window.offScript = ctx; // handy when testing; holds nothing that leaves the phone

  applyLook(ctx.settings);
  const model = await store.get('script');
  if (model) {
    ctx.model = model;
    ctx.index = indexModel(model);
    for (const s of await store.allStates()) ctx.states.set(s.id, s);
    if (!(await store.get('streak'))) await ctx.rebuildStreak();
  }
  registerServiceWorker(ctx);

  if (needsInstall()) return ctx.go('install');
  return ctx.go(model ? 'today' : 'setup');
}

function registerServiceWorker(ctx) {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  // The first to take charge of a page is not an update, only what comes after it.
  let charged = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (charged) {
      ctx.update = true;
      if (AT_REST.has(ctx.screen)) return location.reload();
      document.dispatchEvent(new CustomEvent('offscript:update'));
    }
    charged = true;
  });
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}

boot().catch((err) => {
  const root = document.getElementById('app');
  root.textContent = 'Off Script could not start. Close it and open it again. If this keeps happening, storage may be full.';
  console.error(err);
});
