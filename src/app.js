// Starts the app: opens storage, loads what is saved, and shows the right screen.
import { openStore } from './store.js';
import { withDefaults } from './settings.js';
import { indexModel } from './items.js';
import { newState } from './state.js';
import { buildPlan } from './plan.js';
import { fitFactor } from './memory.js';
import { dayKey, addDays } from './dates.js';
import { clear, focusHeading } from './ui/dom.js';
import { showInstall, needsInstall } from './ui/install.js';
import { showSetup } from './ui/setup.js';
import { showToday } from './ui/today.js';
import { showSprint } from './ui/sprint.js';
import { showScenes, showReader } from './ui/scenes.js';
import { showSettings } from './ui/settings.js';
import { showWalk } from './ui/walk.js';
import { showChoose } from './ui/choose.js';

const SCREENS = { install: showInstall, setup: showSetup, today: showToday, sprint: showSprint, scenes: showScenes, reader: showReader, settings: showSettings, walk: showWalk, choose: showChoose };
const EVENT_DAYS = 9; // the plan looks back this far

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
    manifest: (await store.get('manifest')) || null,
    update: null, // a waiting service worker, when a new version is ready
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
    },

    async undoAnswer(rec) {
      await store.undo(rec.event.key, rec.event.prev);
      ctx.states.set(rec.event.id, rec.event.prev);
      ctx.events = ctx.events.filter((e) => e !== rec.event);
    },

    async saveSettings(patch) {
      Object.assign(ctx.settings, patch);
      applyLook(ctx.settings);
      await store.set('settings', { ...ctx.settings });
    },

    async go(name, params = {}) {
      if (ctx.cleanup) ctx.cleanup();
      ctx.cleanup = null;
      if (ctx.model && name !== 'install' && name !== 'setup') await ctx.refreshEvents();
      clear(ctx.root);
      const result = await SCREENS[name](ctx, params);
      if (typeof result === 'function') ctx.cleanup = result;
      window.scrollTo(0, 0);
      focusHeading(ctx.root);
    },

    applyUpdate() {
      if (!ctx.update) return;
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
      ctx.update.postMessage('skip-waiting');
    },
  };
  window.offScript = ctx; // handy when testing; holds nothing that leaves the phone

  applyLook(ctx.settings);
  const model = await store.get('script');
  if (model) {
    ctx.model = model;
    ctx.index = indexModel(model);
    for (const s of await store.allStates()) ctx.states.set(s.id, s);
  }
  registerServiceWorker(ctx);

  if (needsInstall()) return ctx.go('install');
  return ctx.go(model ? 'today' : 'setup');
}

function registerServiceWorker(ctx) {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      const check = () => {
        if (reg.waiting && navigator.serviceWorker.controller) {
          ctx.update = reg.waiting;
          document.dispatchEvent(new CustomEvent('offscript:update'));
        }
      };
      check();
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => w.state === 'installed' && check());
      });
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
