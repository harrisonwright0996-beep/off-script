import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, inWindow, tick } from '../worker/index.js';

const APPLE = 'https://web.push.apple.com/abc';
const ID = 'f'.repeat(32);

// The Cloudflare rate limit: ten a key, and it keeps nothing a test could read but the keys it saw.
function fakeLimit() {
  const seen = new Map();
  return {
    seen,
    limit: async ({ key }) => {
      seen.set(key, (seen.get(key) || 0) + 1);
      return { success: seen.get(key) <= 10 };
    },
  };
}

function fakeKV() {
  const m = new Map();
  return {
    m,
    get: async (k, type) => {
      const e = m.get(k);
      if (!e) return null;
      return type === 'json' ? JSON.parse(e.v) : e.v;
    },
    put: async (k, v, o = {}) => void m.set(k, { v, metadata: o.metadata }),
    delete: async (k) => void m.delete(k),
    list: async ({ prefix }) => ({ keys: [...m].filter(([k]) => k.startsWith(prefix)).map(([name, e]) => ({ name, metadata: e.metadata })), list_complete: true }),
  };
}

async function env() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    KV: fakeKV(),
    LIMIT: fakeLimit(),
    ORIGIN: 'https://example.github.io',
    VAPID_PUBLIC: 'pub',
    VAPID_SUB: 'https://example.github.io/',
    VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)),
  };
}

const call = (e, path, { method = 'POST', body, ip = '1.1.1.1' } = {}) =>
  handle(new Request(`https://w.dev${path}`, { method, headers: { 'cf-connecting-ip': ip, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), e);

// Wednesday 4 November 2026 at 17:00 UK time; 12:00 is in school, 22:00 is too late.
const AT = Date.UTC(2026, 10, 4, 17);
const subAt = (e, id, nextAt, tries = 0) => e.KV.put(`sub:${id}`, JSON.stringify({ endpoint: `${APPLE}/${id}`, nextAt, tries }), { metadata: { nextAt } });
const idOf = (i) => i.toString(16).padStart(32, '0');

test('a subscription holds only the address and time, and only for real push services', async () => {
  const e = await env();
  assert.equal((await call(e, '/push/sub', { body: { id: ID, endpoint: 'https://evil.example/x', nextAt: AT } })).status, 400);
  assert.equal((await call(e, '/push/sub', { body: { id: ID, endpoint: APPLE, nextAt: AT, name: 'x', lines: 'y' } })).status, 204);
  assert.deepEqual(JSON.parse(e.KV.m.get(`sub:${ID}`).v), { endpoint: APPLE, nextAt: AT, tries: 0 });
  assert.deepEqual(e.KV.m.get(`sub:${ID}`).metadata, { nextAt: AT });
});

test('anything else is turned away, and only the app may read an answer', async () => {
  const e = await env();
  assert.equal((await call(e, '/anything', { body: {} })).status, 404);
  assert.equal((await call(e, '/push/sub', { method: 'GET' })).status, 405);
  assert.equal((await call(e, '/push/sub', { body: null })).status, 400);
  assert.equal((await call(e, '/push/sub', { body: { id: 'short', endpoint: APPLE, nextAt: AT } })).status, 400);
  assert.equal((await call(e, '/push/next', { body: { id: ID, nextAt: 'soon' } })).status, 400);
  assert.equal((await call(e, '/push/next', { body: { id: ID, nextAt: AT } })).status, 404);
  const preflight = await call(e, '/push/sub', { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://example.github.io');
});

test('too many from one address stop that address only', async () => {
  const e = await env();
  for (let i = 0; i < 10; i++) await call(e, '/push/off', { body: { id: ID } });
  assert.equal((await call(e, '/push/off', { body: { id: ID } })).status, 429);
  assert.equal((await call(e, '/push/off', { body: { id: ID }, ip: '2.2.2.2' })).status, 204);
  assert.deepEqual([...e.LIMIT.seen.keys()], ['1.1.1.1', '2.2.2.2']);
});

test('four phones at most, and one already known can always come back', async () => {
  const e = await env();
  for (let i = 1; i <= 4; i++) assert.equal((await call(e, '/push/sub', { body: { id: idOf(i), endpoint: `${APPLE}/${i}`, nextAt: AT } })).status, 204);
  assert.equal((await call(e, '/push/sub', { body: { id: idOf(5), endpoint: `${APPLE}/5`, nextAt: AT } })).status, 403);
  assert.equal((await call(e, '/push/sub', { body: { id: idOf(4), endpoint: `${APPLE}/new`, nextAt: AT } })).status, 204);
  await call(e, '/push/off', { body: { id: idOf(1) } });
  assert.equal((await call(e, '/push/sub', { body: { id: idOf(5), endpoint: `${APPLE}/5`, nextAt: AT } })).status, 204);
});

test('reminder times', () => {
  assert.equal(inWindow(AT), true);
  assert.equal(inWindow(Date.UTC(2026, 10, 4, 12)), false);
  assert.equal(inWindow(Date.UTC(2026, 10, 4, 15, 59)), false);
  assert.equal(inWindow(Date.UTC(2026, 10, 4, 21, 29)), true);
  assert.equal(inWindow(Date.UTC(2026, 10, 4, 21, 30)), false);
  assert.equal(inWindow(Date.UTC(2026, 10, 7, 10)), true); // a Saturday morning
  assert.equal(inWindow(Date.UTC(2026, 10, 7, 9, 59)), false);
  assert.equal(inWindow(Date.UTC(2026, 10, 7, 21)), false);
  assert.equal(inWindow(Date.UTC(2026, 6, 1, 15, 30)), true); // July: 16:30 in the UK
});

test('a due reminder is one empty, signed push; then three tries; then it stops', async () => {
  const e = await env();
  await call(e, '/push/sub', { body: { id: ID, endpoint: APPLE, nextAt: AT - 1 } });
  const sent = [];
  const send = async (url, init) => (sent.push({ url, init }), new Response(null, { status: 201 }));
  assert.equal(await tick(e, AT, send), 1);
  assert.equal(sent[0].init.body, undefined);
  assert.match(sent[0].init.headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=pub$/);
  assert.equal(await tick(e, AT, send), 0); // not again the same day
  let at = AT;
  for (const days of [1, 2, 3]) {
    const next = JSON.parse(e.KV.m.get(`sub:${ID}`).v).nextAt;
    assert.equal(next, at + days * 86400000);
    at = next;
    await tick(e, at, send);
  }
  assert.equal(e.KV.m.has(`sub:${ID}`), false);
  assert.equal(sent.length, 4);
});

test('the signature is good for the push service and names the app', async () => {
  const e = await env();
  await subAt(e, ID, 1);
  let auth;
  await tick(e, AT, async (url, init) => ((auth = init.headers.Authorization), new Response(null, { status: 201 })));
  const [, token] = /^vapid t=([^,]+),/.exec(auth);
  const [head, claims, sig] = token.split('.');
  const body = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.equal(body.aud, 'https://web.push.apple.com');
  assert.equal(body.sub, 'https://example.github.io/');
  assert.ok(body.exp > AT / 1000);
  const jwk = JSON.parse(e.VAPID_PRIVATE_JWK);
  const { d, ...pub } = jwk;
  const key = await crypto.subtle.importKey('jwk', { ...pub, key_ops: ['verify'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(sig, 'base64url'), new TextEncoder().encode(`${head}.${claims}`)));
});

test('nothing goes out in school hours, and a gone phone is forgotten', async () => {
  const e = await env();
  await call(e, '/push/sub', { body: { id: ID, endpoint: APPLE, nextAt: 1 } });
  assert.equal(await tick(e, Date.UTC(2026, 10, 4, 12), async () => assert.fail('sent')), 0);
  await tick(e, AT, async () => new Response(null, { status: 410 }));
  assert.equal(e.KV.m.has(`sub:${ID}`), false);
});

test('one that throws stops no other, and is not sent again every tick', async () => {
  const e = await env();
  await subAt(e, idOf(1), 1);
  await subAt(e, idOf(2), 2);
  await subAt(e, 'broken', 0);
  e.KV.m.get('sub:broken').v = 'not json';
  const sent = [];
  const send = async (url) => {
    sent.push(url);
    if (url.endsWith(idOf(1))) throw new Error('no route');
    return new Response(null, { status: 201 });
  };
  assert.equal(await tick(e, AT, send), 1);
  assert.equal(sent.length, 2);
  await tick(e, AT, send);
  assert.equal(sent.length, 2);
  assert.equal(JSON.parse(e.KV.m.get(`sub:${idOf(1)}`).v).nextAt, AT + 86400000);
});

test('the state is saved before the push goes', async () => {
  const e = await env();
  await subAt(e, ID, 1);
  await subAt(e, 'e'.repeat(32), 2, 3); // its last try
  const seen = [];
  await tick(e, AT, async (url) => {
    seen.push(e.KV.m.has(url.includes(ID) ? `sub:${ID}` : `sub:${'e'.repeat(32)}`) && JSON.parse(e.KV.m.get(`sub:${ID}`).v).tries);
    return new Response(null, { status: 201 });
  });
  assert.deepEqual(seen, [1, false]);
});

test('what the push service answers: 4xx forgets the phone, 429 and 5xx do not', async () => {
  for (const [status, kept] of [[400, false], [403, false], [404, false], [410, false], [413, false], [429, true], [500, true], [503, true]]) {
    const e = await env();
    await subAt(e, ID, 1);
    assert.equal(await tick(e, AT, async () => new Response(null, { status })), 0, `${status}`);
    assert.equal(e.KV.m.has(`sub:${ID}`), kept, `${status}`);
    if (kept) assert.equal(await tick(e, AT, async () => assert.fail('sent again')), 0); // waits for its next try
  }
});

test('opening the app resets the tries; off deletes the record', async () => {
  const e = await env();
  await call(e, '/push/sub', { body: { id: ID, endpoint: APPLE, nextAt: 1 } });
  await tick(e, AT, async () => new Response(null, { status: 201 }));
  await call(e, '/push/next', { body: { id: ID, nextAt: AT + 5 } });
  assert.deepEqual(JSON.parse(e.KV.m.get(`sub:${ID}`).v), { endpoint: APPLE, nextAt: AT + 5, tries: 0 });
  await call(e, '/push/off', { body: { id: ID } });
  assert.equal(e.KV.m.has(`sub:${ID}`), false);
});

test('push keys work with the worker, and the public key is the raw P-256 point', async () => {
  const { makeVapid } = await import('../tools/reminders-setup.mjs');
  const { jwk, publicKey } = await makeVapid();
  assert.equal(Buffer.from(publicKey, 'base64url').length, 65);
  assert.equal(jwk.crv, 'P-256');
  assert.ok(jwk.d);
});
