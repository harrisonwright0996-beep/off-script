import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from '../vendor/fflate.js';
import { readDocxParagraphs, paragraphsFromXml, DocxError } from '../src/docx.js';
import { parseScript, summarise } from '../src/parse.js';
import { buildFixtureDocx, LONG_SPEECH } from './fixtures/night-ferry.mjs';

const parsed = parseScript(readDocxParagraphs(buildFixtureDocx()));
const speeches = (sc) => sc.events.filter((e) => e.t === 'speech' && !e.screen);

test('the fixture parses into four scenes with the right totals', () => {
  assert.deepEqual(summarise(parsed), { scenes: 4, speeches: 22, words: 145, screen: 3, directions: 5, speakers: 9 });
  assert.deepEqual(parsed.scenes.map((s) => [s.name, s.title]), [
    ['Prologue', ''],
    ['Scene 1', 'The Harbour'],
    ['Scene 2', 'The Crossing'],
    ['Scene 3', 'Landfall'],
  ]);
});

test('front matter is skipped and THE END stops the play', () => {
  const all = JSON.stringify(parsed);
  assert.ok(!all.includes('THE NIGHT FERRY'));
  assert.ok(!all.includes('Thank you for reading'));
});

test('a paragraph after a tab speech continues it until a blank line', () => {
  assert.deepEqual(speeches(parsed.scenes[0])[0].lines, ['We are the ones who stayed.', 'We are the ones who waited.']);
});

test('standalone labels give the next paragraph to that role, generic roles included', () => {
  const roles = speeches(parsed.scenes[1]).map((e) => e.role);
  assert.deepEqual(roles, ['KEEPER', 'PILOT', 'KEEPER', 'CLERK', 'CLERK', 'MUM', 'PILOT’S DAD', 'CLERK AS HER PARENT', 'CLERK AS HER PARENT', 'STRANGER (AS HIS MUM)', 'STRANGER']);
});

test('a non italic paragraph with no open speech goes to the last speaker', () => {
  const s = speeches(parsed.scenes[1]);
  assert.equal(s[8].role, 'CLERK AS HER PARENT');
  assert.deepEqual(s[8].lines, ['And I meant it.']);
});

test('the paragraph after a PLACARDS label is a held placard, not a speech', () => {
  const placards = parsed.scenes[1].events.filter((e) => e.t === 'placard');
  assert.deepEqual(placards, [{ t: 'placard', text: 'NO RETURN TICKETS' }]);
});

test('italic text after a tab is on screen; italic paragraphs are directions', () => {
  const sc1 = parsed.scenes[1].events;
  assert.ok(sc1.some((e) => e.t === 'speech' && e.screen && e.role === 'PHONE'));
  assert.ok(sc1.some((e) => e.t === 'dir' && e.text === 'She reads it.'));
  assert.equal(speeches(parsed.scenes[2]).length, 0);
});

test('tracked deletions are dropped, insertions and hyperlinks kept', () => {
  assert.deepEqual(speeches(parsed.scenes[3])[1].lines, ['We really did.']);
});

test('the long speech stays whole in the parse', () => {
  assert.ok(speeches(parsed.scenes[1]).some((e) => e.lines.join(' ') === LONG_SPEECH));
});

test('run properties: w:i on, w:i w:val="0" off; breaks and entities', () => {
  const xml = '<w:body><w:p><w:r><w:rPr><w:i w:val="0"/></w:rPr><w:t>plain</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>slanted &amp; more</w:t></w:r><w:r><w:br/><w:t>next</w:t></w:r></w:p></w:body>';
  const [p] = paragraphsFromXml(xml);
  assert.deepEqual(p.runs, [
    { text: 'plain', italic: false },
    { text: 'slanted & more', italic: true },
    { text: '\nnext', italic: false },
  ]);
});

test('wrong files give clear error codes', () => {
  assert.throws(() => readDocxParagraphs(strToU8('hello world')), (e) => e instanceof DocxError && e.code === 'not-zip');
  assert.throws(() => readDocxParagraphs(zipSync({ 'a.txt': strToU8('x') })), (e) => e.code === 'no-document');
  assert.throws(() => readDocxParagraphs(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0])), (e) => e.code === 'bad-zip');
});
