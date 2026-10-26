// An invented audio pack for tests: valid silent MP3 frames (MPEG 2 Layer III, 22,050 Hz,
// mono, 32 kbps) shaped like the real pack made by tools/render-audio.mjs.
import { zipSync, strToU8 } from '../../vendor/fflate.js';
import { concatBytes } from '../../src/mp3.js';
import { fnv1a } from '../../src/items.js';

export function silentMp3(frames) {
  const parts = [];
  for (let i = 0; i < frames; i++) {
    const f = new Uint8Array(104); // all zero side information: decodes as silence
    f.set([0xff, 0xf3, 0x40, 0xc4]);
    parts.push(f);
  }
  return concatBytes(parts);
}

export function buildFixturePack(model, { skip = 0 } = {}) {
  const files = {};
  const clip = (name, frames) => {
    files[name] = silentMp3(frames);
    return { file: name, duration: (frames * 576) / 22050 };
  };
  const manifest = { version: 1, scriptHash: model.hash, sampleRate: 22050, bitrate: 32000, made: '2026-10-26', silence: clip('s250.mp3', 10), items: {}, speakers: {}, headings: {} };
  model.items.slice(skip).forEach((it) => {
    manifest.items[it.id] = { line: clip(`l-${it.id}.mp3`, 8 + it.words * 8), cue: clip(`c-${it.id}.mp3`, 20) };
  });
  for (const sp of new Set(model.items.map((i) => i.speaker))) manifest.speakers[sp] = clip(`p-${fnv1a(sp)}.mp3`, 15);
  for (const sc of model.scenes) manifest.headings[sc.index] = clip(`h-${sc.index}.mp3`, 25);
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  return zipSync(files, { level: 0 });
}
