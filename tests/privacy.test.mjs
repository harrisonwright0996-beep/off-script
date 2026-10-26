import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNames, namePattern, findNames, riskyFiles, personalEmails } from '../tools/privacy-check.mjs';

// Invented names only: the real list never comes near this repository.
const LIST = `# people
Quillon
ZEPHRINE'S AUNT
  Oriel   Vantwood
X
`;

test('the list skips comments, blank lines and single letters', () => {
  assert.deepEqual(readNames(LIST), ['Quillon', "ZEPHRINE'S AUNT", 'Oriel   Vantwood']);
});

test('names match as whole words in any case, with either kind of apostrophe', () => {
  const p = namePattern(readNames(LIST));
  for (const s of ['quillon said so', 'QUILLON.', '(Quillon)', 'Zephrine’s aunt waves', 'oriel vantwood', 'Oriel\tVantwood']) assert.ok(p.test(s), s);
  for (const s of ['Quillons', 'aQuillon', 'Zephrine waves', 'Oriel', 'Vantwood alone']) assert.ok(!p.test(s), s);
});

test('hits give the place and line number, never the name', () => {
  const p = namePattern(['Quillon']);
  const hits = findNames(p, [
    { where: 'README.md', text: 'one\nquillon two\nthree' },
    { where: 'commit messages', text: 'Add Quillon' },
    { where: 'src/x.js', text: 'nothing here' },
  ]);
  assert.deepEqual(hits, [{ where: 'README.md', line: 2 }, { where: 'commit messages', line: 1 }]);
});

test('script, document and audio files are counted by kind, other files are not', () => {
  assert.deepEqual(riskyFiles(['a/Play.DOCX', 'pack.zip', 'b.mp3', 'c.mp3', 'icons/icon.png', 'src/app.js', 'notes.md']), { '.docx': 1, '.zip': 1, '.mp3': 2 });
});

test('only GitHub noreply addresses may appear on commits', () => {
  const ok = '123+someone@users.noreply.github.com';
  assert.deepEqual(personalEmails([ok, ok, '', 'someone@example.com', 'someone@example.com']), ['someone@example.com']);
});
