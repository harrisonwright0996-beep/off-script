// Reads the audio pack zip made on the laptop by tools/render-audio.mjs:
// manifest.json plus one MP3 per line, cue, speaker name and scene heading, and a silence unit.
import { unzipSync, strFromU8 } from '../vendor/fflate.js';
import { parseMp3 } from './mp3.js';

export const PACK_VERSION = 1;

export class PackError extends Error {
  constructor(code) {
    super(code);
    this.code = code; // 'not-zip' | 'bad-zip' | 'no-manifest' | 'bad-manifest' | 'bad-clip'
  }
}

const refs = (m) => [
  m.silence,
  ...Object.values(m.items).flatMap((x) => [x.line, x.cue].filter(Boolean)),
  ...Object.values(m.speakers),
  ...Object.values(m.headings),
];

export function readAudioPack(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 4 || u8[0] !== 0x50 || u8[1] !== 0x4b) throw new PackError('not-zip');
  let files;
  try {
    files = unzipSync(u8);
  } catch {
    throw new PackError('bad-zip');
  }
  if (!files['manifest.json']) throw new PackError('no-manifest');
  let manifest;
  try {
    manifest = JSON.parse(strFromU8(files['manifest.json']));
  } catch {
    throw new PackError('bad-manifest');
  }
  if (manifest.version !== PACK_VERSION || !manifest.silence || !manifest.items || !manifest.speakers || !manifest.headings) {
    throw new PackError('bad-manifest');
  }
  const clips = new Map();
  for (const ref of refs(manifest)) {
    if (clips.has(ref.file)) continue;
    const data = files[ref.file];
    if (!data) throw new PackError('bad-clip');
    try {
      const mp3 = parseMp3(data);
      ref.duration = mp3.duration; // trust the frames, not the manifest
      clips.set(ref.file, mp3.bytes.slice());
    } catch {
      throw new PackError('bad-clip');
    }
  }
  return { manifest, clips };
}

// How well a pack fits the script on the phone.
export function packFit(manifest, model) {
  const ids = model.items.map((it) => it.id);
  const have = ids.filter((id) => manifest.items[id]).length;
  return { sameScript: manifest.scriptHash === model.hash, have, missing: ids.length - have };
}
