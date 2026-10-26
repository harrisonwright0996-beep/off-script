import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseVoices, wavSamples, wavOfSilence } from '../tools/render-audio.mjs';

// As `say -v ?` lists them on the laptop: some twice, some with their language.
const VOICES = [
  { name: 'Daniel (English (UK))', locale: 'en_GB' },
  { name: 'Daniel (English (UK))', locale: 'en_GB' },
  { name: 'Moira', locale: 'en_IE' },
  { name: 'Karen', locale: 'en_AU' },
  { name: 'Tessa (English (South Africa))', locale: 'en_ZA' },
  { name: 'Alex', locale: 'en_US' },
];
const OTHERS = ['Moira', 'Karen', 'Tessa (English (South Africa))'];

test('a silent WAV of half a second holds 11,025 samples, and other files hold none', () => {
  assert.equal(wavSamples(new Uint8Array(wavOfSilence(0.5))), 11025);
  assert.equal(wavSamples(new Uint8Array(44)), 0);
  assert.equal(wavSamples(new TextEncoder().encode('not a wav file at all')), 0);
});

test('the sound is found after other chunks, as macOS sometimes writes them', () => {
  const wav = new Uint8Array(wavOfSilence(0.1));
  const filler = [...new TextEncoder().encode('FLLR'), 4, 0, 0, 0, 0, 0, 0, 0];
  assert.equal(wavSamples(new Uint8Array([...wav.subarray(0, 36), ...filler, ...wav.subarray(36)])), 2205);
});

test('the narrator is Daniel, and each speaker gets a stable British style voice of their own', () => {
  const speakers = new Set(['Pilot', 'Keeper', 'Clerk']);
  const map = chooseVoices(speakers, VOICES);
  assert.equal(map.narrator, 'Daniel (English (UK))');
  assert.deepEqual(Object.keys(map.speakers), ['Clerk', 'Keeper', 'Pilot']);
  for (const v of Object.values(map.speakers)) assert.ok(OTHERS.includes(v), v);
  assert.deepEqual(chooseVoices(new Set(['Clerk', 'Keeper', 'Pilot']), VOICES), map);
});

test('choices in voices.json stay while that voice is on the Mac, and are replaced when it is not', () => {
  const map = chooseVoices(new Set(['Keeper', 'Pilot']), VOICES, { narrator: 'Karen', speakers: { Keeper: 'Moira', Pilot: 'Fiona' } });
  assert.equal(map.narrator, 'Karen');
  assert.equal(map.speakers.Keeper, 'Moira');
  assert.ok(OTHERS.includes(map.speakers.Pilot));
  // A short name saved earlier still counts once the Mac lists the voice with its language.
  assert.equal(chooseVoices(new Set(['Keeper']), VOICES, { speakers: { Keeper: 'Tessa' } }).speakers.Keeper, 'Tessa');
});
