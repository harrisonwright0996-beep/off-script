import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');
const ls = (dir, ext) => readdirSync(new URL(dir + '/', root)).filter((f) => f.endsWith(ext)).map((f) => `${dir}/${f}`);

test('the offline cache lists every app file, and only those', () => {
  const listed = [...read('sw.js').matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]);
  const want = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'vendor/fflate.js', ...ls('src', '.js'), ...ls('src/ui', '.js'), ...ls('icons', '.png')];
  assert.deepEqual([...listed].sort(), want.sort());
});

test('the page cannot send anything anywhere, and has no inline script or style', () => {
  const html = read('index.html');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.equal(csp, "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline scripts');
  assert.doesNotMatch(html, /<style|\sstyle=/, 'no inline styles');
  for (const f of [...ls('src', '.js'), ...ls('src/ui', '.js')]) assert.doesNotMatch(read(f), /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/, `${f} sends nothing`);
});

test('no italics anywhere', () => {
  assert.match(read('styles.css'), /font-style: normal !important/);
  for (const f of [...ls('src/ui', '.js'), 'index.html']) assert.doesNotMatch(read(f), /<(i|em)>|'(i|em)'/, `${f} uses no italic elements`);
});
