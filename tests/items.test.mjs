import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureModel } from './helpers.mjs';
import { buildModel, chunkSpeech, cueTail, displayRole, speakerChoices, spineItemIds } from '../src/items.js';
import { parseScript } from '../src/parse.js';
import { readDocxParagraphs } from '../src/docx.js';
import { buildFixtureDocx, fixtureXml, LONG_SPEECH } from './fixtures/night-ferry.mjs';
import { keyedCount, tokenize } from '../src/tokens.js';

const { model, index } = fixtureModel();
const item = (scene, n, part = 0) => model.items.find((i) => i.scene === scene && i.n === n && i.part === part);

test('totals for the fixture', () => {
  assert.deepEqual(model.totals, { speeches: 22, words: 143, items: 23, beats: 4 });
});

test('speaker labels are shown in title case', () => {
  assert.equal(displayRole('PILOT’S DAD'), "Pilot's Dad");
  assert.equal(displayRole('CLERK AS HER PARENT'), 'Clerk as her Parent');
  assert.equal(displayRole('STRANGER (AS HIS MUM)'), 'Stranger (as his Mum)');
  assert.equal(displayRole('CAST'), 'Cast');
});

test('speeches over 40 words split at sentence ends into chunks of 15 to 35 words', () => {
  const chunks = chunkSpeech(LONG_SPEECH);
  assert.equal(chunks.join(' '), LONG_SPEECH);
  assert.deepEqual(chunks.map((c) => keyedCount(tokenize(c))), [24, 26, 14]);
  const parts = model.items.filter((i) => i.scene === 1 && i.n === 5);
  assert.deepEqual(parts.map((p) => [p.part, p.parts, p.askSpeaker]), [[0, 3, true], [1, 3, false], [2, 3, false]]);
});

test('a single sentence over 35 words splits at commas', () => {
  const long = 'One two three four five six seven eight nine ten, eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty, twenty one two three four five six seven eight nine, thirty one two three four five six seven eight nine forty.';
  const chunks = chunkSpeech(long);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((c) => keyedCount(tokenize(c)) <= 35));
  assert.equal(chunks.join(' '), long);
});

test('cue tails: last sentence, short ones joined to the one before, 12 words at most, no directions', () => {
  assert.equal(cueTail('(Texting.) On my way… wait—what?'), 'On my way… wait—what?');
  assert.equal(cueTail('She’s fine. Leave her be.'), 'She’s fine. Leave her be.');
  assert.equal(cueTail('I stood at the rail and counted the gulls until I lost count every single day.'), '…rail and counted the gulls until I lost count every single day.');
});

test('a scene opens with its heading and first direction as the cue', () => {
  assert.deepEqual(item(1, 1).cue, { speaker: null, text: 'Scene 1: The Harbour', notes: ['[The harbour at night.]'] });
});

test('cues carry what happens in between: placards, on screen text, directions, silent speeches', () => {
  assert.deepEqual(item(1, 4).cue.notes, ['[Placard: NO RETURN TICKETS]']);
  assert.deepEqual(item(1, 5).cue.notes, ['[On screen, Phone: New message: where are you?]', '[She reads it.]']);
  assert.deepEqual(item(3, 4).cue.notes, ['[Keeper: Nods.]']);
  assert.equal(item(3, 4).cue.speaker, 'Pilot');
});

test('a speech that is only a direction is shown in the reader but never tested', () => {
  const sc = model.scenes[3];
  const silent = sc.reader.find((r) => r.t === 'speech' && r.n === 3);
  assert.deepEqual(silent.itemIds, []);
  assert.ok(!model.items.some((i) => i.scene === 3 && i.n === 3));
});

test('ids are stable, unique, and survive a rebuild; repeated lines get their own ids', () => {
  const again = buildModel(parseScript(readDocxParagraphs(buildFixtureDocx())));
  assert.deepEqual(again.items.map((i) => i.id), model.items.map((i) => i.id));
  assert.equal(new Set(model.items.map((i) => i.id)).size, model.items.length);
  const homes = model.items.filter((i) => i.text === 'Home.');
  assert.equal(homes.length, 2);
  assert.notEqual(homes[0].id, homes[1].id);
});

test('changing one line changes only that item id', () => {
  const edited = buildModel(parseScript(readDocxParagraphs(buildFixtureDocx(fixtureXml().replace('Come home now.', 'Come home right now.')))));
  const before = model.items.map((i) => i.id);
  const after = edited.items.map((i) => i.id);
  const changed = before.filter((id, i) => id !== after[i]);
  assert.equal(changed.length, 1);
  assert.notEqual(edited.hash, model.hash);
});

test('every item is in exactly one beat of its own scene, in order', () => {
  const seen = model.beats.flatMap((b) => b.itemIds);
  assert.deepEqual(seen, model.items.map((i) => i.id));
  for (const b of model.beats) for (const id of b.itemIds) assert.equal(index.byId.get(id).scene, b.scene);
  assert.deepEqual(model.beats.map((b) => b.itemIds.length), [4, 4, 9, 6]);
});

test('spine is the first item of each scene with spoken lines', () => {
  assert.deepEqual(spineItemIds(model), [item(0, 1).id, item(1, 1).id, item(3, 1).id]);
});

test('speaker choices: the right one plus nearby speakers, A to Z, at most six', () => {
  const it = item(1, 7);
  const choices = speakerChoices(model, it);
  assert.ok(choices.includes(it.speaker));
  assert.ok(choices.length <= 6 && choices.length >= 2);
  assert.deepEqual(choices, [...choices].sort((a, b) => a.localeCompare(b, 'en-GB')));
  assert.equal(new Set(choices).size, choices.length);
});
