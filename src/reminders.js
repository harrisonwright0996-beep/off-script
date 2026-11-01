// Reminders. The phone works out when the next one should come, from today's plan, and tells a small
// worker only that time. The worker sends an empty push; the words are written here and shown by the
// service worker, so the script and everything about it stay on the phone.
import { HOUR } from './memory.js';
import { phaseOf } from './plan.js';
import { addDays, dayEnd, dayKey } from './dates.js';

// Neither is secret. The same address is in the page's Content Security Policy.
export const WORKER = 'https://off-script-reminders.off-script-lines.workers.dev';
export const VAPID_PUBLIC = 'BHjFoBE9tpkzPvU7oWVLVde0z8B21nlqDT4_VwG5ggYE4oAPOvwqpvvKEn_qkMe6Wr_MvJk6UllJoqdnjDIPeoo';

const LATER_TODAY = 3 * HOUR; // today's plan is not done: this long after he last used the app
const MAX_GAP = 7 * 24 * HOUR;
const EVERY_DAY = ['final', 'deadline', 'show']; // every line every day: there is always a plan

// When the next reminder should come. One that falls outside the worker's hours waits for them to open.
export function nextNudge({ plan, settings }) {
  const { now } = plan;
  if (!plan.done) return now + LATER_TODAY;
  const today = dayKey(new Date(now));
  const tomorrow = dayEnd(today);
  if (plan.ahead.length) return tomorrow; // new lines are left, so tomorrow has its share
  // Only upkeep left: when the next line falls due, or the next day every line is checked.
  let every = Infinity;
  for (let i = 0; i < 7 && every === Infinity; i++) if (EVERY_DAY.includes(phaseOf(addDays(today, i + 1), settings))) every = dayEnd(addDays(today, i));
  return Math.min(now + MAX_GAP, Math.max(tomorrow, Math.min(plan.nextAt ?? Infinity, every)));
}

const WORDS = {
  today: ['Some of today’s plan is still to do. Fancy a sprint or a walk?', 'A few minutes now does more than a long go later.'],
  fresh: ['Today’s plan is ready when you are.', 'New lines are waiting. Fancy a sprint or a walk?'],
  keep: ['Lines you know still fade if you leave them. A few minutes keeps them safe.', 'Knowing it once is not the same as keeping it. A few minutes keeps it.'],
};

// The words are saved now and shown when the push comes, so they have to be true then: nothing that
// counts lines or minutes, and never a name or a line.
export function nudgeText({ plan, turn = 0 }) {
  const list = !plan.done ? WORDS.today : plan.ahead.length ? WORDS.fresh : WORDS.keep;
  return { title: 'Off Script', body: list[turn % list.length] };
}

export const canPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const randomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
const post = (path, body) => fetch(`${WORKER}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function saveWords(ctx, plan) {
  const turn = ((await ctx.store.get('nudgeTurn')) || 0) + 1;
  await ctx.store.set('nudgeTurn', turn);
  await ctx.store.set('reminder', nudgeText({ plan, turn }));
}

// From a tap: the phone asks for permission here. Returns true when reminders are on.
export async function enable(ctx) {
  if ((await Notification.requestPermission()) !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC) }));
  const id = randomId();
  const plan = ctx.plan();
  const res = await post('/push/sub', { id, endpoint: sub.endpoint, nextAt: nextNudge({ plan, settings: ctx.settings }) });
  if (!res.ok) return false;
  await ctx.store.set('push', { id, endpoint: sub.endpoint });
  await saveWords(ctx, plan);
  return true;
}

const currentSub = async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
};

// The phone's own word on reminders: if notifications were taken away, or the subscription has gone,
// they are off here too. Returns the subscription while they are on.
export async function liveSub(ctx) {
  const push = await ctx.store.get('push');
  if (!push || !canPush()) return null;
  const sub = await currentSub();
  if (sub && Notification.permission === 'granted') return sub;
  await ctx.store.del('push');
  return null;
}

// After practice, and when Today opens: the next time, and fresh words. Waits for no one: offline,
// the time already at the worker stands.
export async function sync(ctx) {
  try {
    const sub = await liveSub(ctx);
    if (!sub) return;
    const push = await ctx.store.get('push');
    const plan = ctx.plan();
    await saveWords(ctx, plan);
    const nextAt = nextNudge({ plan, settings: ctx.settings });
    const res = sub.endpoint === push.endpoint ? await post('/push/next', { id: push.id, nextAt }) : { status: 404 };
    if (res.status === 404) {
      // Stopped after reminders went unopened, or the phone has changed the address: back on now.
      const sent = await post('/push/sub', { id: push.id, endpoint: sub.endpoint, nextAt });
      if (sent.ok) await ctx.store.set('push', { id: push.id, endpoint: sub.endpoint });
    }
  } catch {
    // no signal: nothing to do
  }
}

export async function disable(ctx) {
  const push = await ctx.store.get('push');
  await ctx.store.del('push');
  const unsubscribe = async () => {
    const sub = await currentSub();
    if (sub) await sub.unsubscribe();
  };
  const forget = async () => push && post('/push/off', { id: push.id });
  // Each goes ahead whatever becomes of the other. With no signal the push address is still gone from
  // the phone, so the worker forgets it at the next send.
  await Promise.allSettled([unsubscribe(), forget()]);
}
