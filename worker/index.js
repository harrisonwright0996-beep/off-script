// Reminders, and nothing else. A phone that has turned them on says when the next one should come, and
// this sends it an empty push then; the phone writes the words itself. It never sees a name, a line or a
// result: only the push address the phone's browser made, and a time.
// KV: sub:<id> { endpoint, nextAt, tries }, with nextAt in the metadata.
// LIMIT: a rate limit by address. The app's code is public, so it can hold no secret to check: a
// record's random id is the key to it, and MAX_SUBS keeps the rest small. Nothing is stored for it.
// Secrets: VAPID_PUBLIC, VAPID_PRIVATE_JWK, VAPID_SUB.
const HOUR = 3600;
const DAY = 86400000;
const RETRY_DAYS = [1, 2, 3]; // after a reminder that was not opened; then it stops
const TTL = 4 * HOUR; // a reminder that cannot get through by then is no use
const MAX_SUBS = 4; // one person, and an old record or two
const MAX_TICK = 10;
const PUSH_HOSTS = /^https:\/\/(web\.push\.apple\.com|fcm\.googleapis\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com)\//;

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const text = (s) => new TextEncoder().encode(s);

const cors = (env) => ({
  'Access-Control-Allow-Origin': env.ORIGIN,
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
});

// Whether this moment is one a reminder can go out: after school, not late, in UK time.
export function inWindow(now) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now));
  const get = (type) => parts.find((p) => p.type === type).value;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  const weekend = ['Sat', 'Sun'].includes(get('weekday'));
  return weekend ? minutes >= 600 && minutes < 1260 : minutes >= 960 && minutes < 1290;
}

const isId = (v) => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
const addressOf = (request) => request.headers.get('cf-connecting-ip') || 'unknown';
const putSub = (env, id, sub) => env.KV.put(`sub:${id}`, JSON.stringify(sub), { metadata: { nextAt: sub.nextAt } });

async function allSubs(env) {
  const keys = [];
  let cursor;
  do {
    const page = await env.KV.list({ prefix: 'sub:', cursor });
    keys.push(...page.keys);
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return keys;
}

export async function handle(request, env) {
  const head = cors(env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: head });
  const reply = (status) => new Response(null, { status, headers: head });
  const { pathname } = new URL(request.url);
  if (!/^\/push\/(sub|next|off)$/.test(pathname)) return reply(404);
  if (request.method !== 'POST') return reply(405);
  if (!(await env.LIMIT.limit({ key: addressOf(request) })).success) return reply(429);
  const body = await request.json().catch(() => null);
  if (!isId(body?.id)) return reply(400);
  const name = `sub:${body.id}`;
  if (pathname === '/push/off') {
    await env.KV.delete(name);
    return reply(204);
  }
  if (!Number.isFinite(body.nextAt)) return reply(400);
  if (pathname === '/push/sub') {
    if (typeof body.endpoint !== 'string' || !PUSH_HOSTS.test(body.endpoint)) return reply(400);
    if ((await allSubs(env)).filter((k) => k.name !== name).length >= MAX_SUBS) return reply(403);
    await putSub(env, body.id, { endpoint: body.endpoint, nextAt: body.nextAt, tries: 0 });
    return reply(204);
  }
  const old = await env.KV.get(name, 'json');
  if (!old) return reply(404);
  await putSub(env, body.id, { ...old, nextAt: body.nextAt, tries: 0 });
  return reply(204);
}

// The signature a push service asks for (VAPID), good for 12 hours, so one tick needs one for each
// service, however many phones it reaches. made: those made so far this tick.
function vapid(endpoint, env, now, made) {
  const aud = new URL(endpoint).origin;
  if (!made.has(aud)) made.set(aud, signVapid(aud, env, now));
  return made.get(aud);
}

async function signVapid(aud, env, now) {
  const head = b64url(text(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(text(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * HOUR, sub: env.VAPID_SUB })));
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, text(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64url(sig)}, k=${env.VAPID_PUBLIC}`;
}

// One reminder. The new state is saved first, so a failure here cannot send it again every tick; a
// bad moment at the push service waits for the next try. Returns whether it went.
async function remind(env, name, now, send, made) {
  const sub = await env.KV.get(name, 'json');
  if (!sub) return false;
  if (sub.tries >= RETRY_DAYS.length) await env.KV.delete(name); // never opened: stop
  else await putSub(env, name.slice('sub:'.length), { ...sub, nextAt: now + RETRY_DAYS[sub.tries] * DAY, tries: sub.tries + 1 });
  const res = await send(sub.endpoint, { method: 'POST', headers: { Authorization: await vapid(sub.endpoint, env, now, made), TTL: String(TTL), Urgency: 'normal', 'Content-Length': '0' } });
  if (res.status >= 400 && res.status < 500 && res.status !== 429) await env.KV.delete(name); // the phone has said no, or gone
  return res.ok;
}

// Every 15 minutes: the reminders that are due and may go out now, oldest first. Any left over wait
// for the next tick. One that throws never stops the others.
export async function tick(env, now, send = fetch) {
  if (!inWindow(now)) return 0;
  const due = (await allSubs(env)).filter(({ metadata }) => metadata && metadata.nextAt <= now).sort((a, b) => a.metadata.nextAt - b.metadata.nextAt).slice(0, MAX_TICK);
  let sent = 0;
  const made = new Map();
  for (const { name } of due) {
    try {
      if (await remind(env, name, now, send, made)) sent += 1;
    } catch {
      // the state is saved: this one waits for its next try
    }
  }
  return sent;
}

export default {
  fetch: (request, env) => handle(request, env),
  scheduled: (event, env, ctx) => ctx.waitUntil(tick(env, Date.now())),
};
