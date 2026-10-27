#!/usr/bin/env node
// Makes the Walk audio pack on the laptop (macOS): every line, cue, speaker name and scene heading
// spoken by the Mac's own voices (say), encoded as constant bit rate MP3 (LAME) so the phone can
// join clips byte for byte. It reads the script with the same code as the app, so ids match.
//
//   node tools/render-audio.mjs --script <script.docx> --out <folder> [--jobs 8]
//
// The pack and voices.json are written to --out, which must be outside this repository. Clips are
// cached in ~/Library/Caches/off-script-audio, so a revised script only renders what changed.
// It prints counts only, never the script's words or names. Needs LAME: brew install lame
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { cpus, homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDocxParagraphs } from '../src/docx.js';
import { parseScript } from '../src/parse.js';
import { buildModel, fnv1a } from '../src/items.js';
import { speakable } from '../src/tts.js';
import { parseMp3 } from '../src/mp3.js';
import { PACK_VERSION } from '../src/audiopack.js';
import { zipSync } from '../vendor/fflate.js';

const run = promisify(execFile);
const REPO = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const CACHE = join(homedir(), 'Library', 'Caches', 'off-script-audio');
const RATE = 22050;
const BITRATE = 32000;
const NARRATOR = 'Daniel';
const ACCENTS = /^en_(GB|IE|AU|NZ|ZA)$/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function args(argv) {
  const out = { jobs: Math.max(2, cpus().length) };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    out[key] = key === 'jobs' ? Number(argv[i + 1]) : argv[i + 1];
  }
  return out;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// The English voices installed on this Mac: [{ name, locale }].
export async function installedVoices() {
  const { stdout } = await run('say', ['-v', '?']);
  return stdout
    .split('\n')
    .map((line) => line.match(/^(.+?)\s+([a-z]{2}_[A-Z]{2})\s+#/))
    .filter(Boolean)
    .map((m) => ({ name: m[1].trim(), locale: m[2] }));
}

// One voice per speaker, by a stable rule (a hash of the label), from the British and Irish style
// voices other than the narrator's. voices.json can override any of them, as long as that voice
// is still on the Mac.
export function chooseVoices(speakers, voices, saved = {}) {
  const first = (name) => name.split(' ')[0];
  const english = voices.filter((v) => ACCENTS.test(v.locale));
  const known = (name) => typeof name === 'string' && english.some((v) => v.name === name || first(v.name) === first(name));
  const narrator = (english.find((v) => first(v.name) === NARRATOR) || english[0] || voices[0] || { name: NARRATOR }).name;
  const pool = [...new Set(english.map((v) => v.name))].filter((n) => first(n) !== first(narrator));
  const map = { narrator: known(saved.narrator) ? saved.narrator : narrator, speakers: {} };
  for (const sp of [...speakers].sort()) {
    const mine = saved.speakers?.[sp];
    map.speakers[sp] = known(mine) ? mine : pool.length ? pool[parseInt(fnv1a(sp), 36) % pool.length] : map.narrator;
  }
  return map;
}

// Samples in a 16 bit WAV file, or 0 if it is not one.
export function wavSamples(bytes) {
  const ascii = (p) => String.fromCharCode(...bytes.subarray(p, p + 4));
  if (bytes.length < 12 || ascii(0) !== 'RIFF' || ascii(8) !== 'WAVE') return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let p = 12; p + 8 <= bytes.length; ) {
    const size = view.getUint32(p + 4, true);
    if (ascii(p) === 'data') return Math.floor(Math.min(size, bytes.length - p - 8) / 2);
    p += 8 + size + (size % 2);
  }
  return 0;
}

// The voices that really speak. A voice can be listed while macOS is still downloading or
// updating it, and then it says nothing.
async function speakingVoices(voices, work) {
  const ok = await Promise.all(
    voices.map(async (v, i) => {
      const wav = join(work, `probe-${i}.wav`);
      try {
        await run('say', ['-v', v.name, '--data-format=LEI16@22050', '-o', wav, 'Hello.']);
        return wavSamples(new Uint8Array(await readFile(wav))) > RATE / 10;
      } catch {
        return false;
      }
    }),
  );
  return voices.filter((_, i) => ok[i]);
}

export function wavOfSilence(seconds) {
  const samples = Math.round(seconds * RATE);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

async function encode(wav, mp3) {
  await run('lame', ['--quiet', '-t', '-m', 'm', '-b', String(BITRATE / 1000), '--cbr', '--resample', String(RATE / 1000), wav, mp3]);
}

// A clip's frames, or an error if it is empty or not in the pack's format.
function checked(bytes) {
  const mp3 = parseMp3(bytes);
  if (mp3.sampleRate !== RATE || mp3.channels !== 1 || mp3.bitrate !== BITRATE) throw new Error('A clip came out in the wrong format.');
  return mp3;
}

async function speak(voice, job, work, name) {
  const wav = join(work, `${name}.wav`);
  const mp3 = join(work, `${name}.mp3`);
  if (job.silence) await writeFile(wav, wavOfSilence(job.silence));
  else {
    const txt = join(work, `${name}.txt`);
    await writeFile(txt, job.text);
    await run('say', ['-v', voice, '--data-format=LEI16@22050', '-o', wav, '-f', txt]);
  }
  await encode(wav, mp3);
  return new Uint8Array(await readFile(mp3));
}

const keyOf = (job) => fnv1a(`${job.voice}|${job.text}|${RATE}|${BITRATE}`);

// Renders one clip (or takes it from the cache) and returns its frames and length. A voice can
// make no sound now and then (while macOS updates it), and say can fail to write a file, so such a
// clip is tried twice more and then read by the narrator instead. Only clips in their own voice
// are cached.
async function render(job, work, narrator) {
  const key = keyOf(job);
  const cached = join(CACHE, `${key}.mp3`);
  if (existsSync(cached)) {
    try {
      const mp3 = checked(new Uint8Array(await readFile(cached)));
      return { bytes: mp3.bytes, duration: mp3.duration, fromCache: true, stoodIn: false };
    } catch {
      await rm(cached, { force: true }); // left broken by an interrupted run: make it again
    }
  }
  const tries = job.silence || job.voice === narrator ? [job.voice, job.voice, job.voice] : [job.voice, job.voice, job.voice, narrator];
  for (const [i, voice] of tries.entries()) {
    if (i > 0) await new Promise((done) => setTimeout(done, 1000 * i));
    let mp3;
    let bytes;
    try {
      bytes = await speak(voice, job, work, `${key}-${i}`);
      mp3 = checked(bytes);
    } catch {
      continue;
    }
    if (voice === job.voice) await writeFile(cached, bytes);
    return { bytes: mp3.bytes, duration: mp3.duration, fromCache: false, stoodIn: voice !== job.voice };
  }
  throw new Error('the Mac made no sound for a clip, even in the narrator’s voice. Check that speech works (say hello), then run it again: finished clips are kept.');
}

async function pool(jobs, size, fn) {
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: size }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      await fn(job);
      done += 1;
      if (done % 100 === 0) console.log(`  ${done} of ${jobs.length} clips`);
    }
  });
  await Promise.all(workers);
}

export async function main(argv) {
  const opt = args(argv);
  if (!opt.script || !opt.out) fail('Usage: node tools/render-audio.mjs --script <script.docx> --out <folder outside this repository>');
  const out = resolve(opt.out);
  await mkdir(out, { recursive: true });
  const rel = relative(REPO, realpathSync(out));
  if (!rel.startsWith('..') && !isAbsolute(rel)) fail('Choose an --out folder outside the repository, so the audio can never be committed.');
  for (const tool of ['say', 'lame']) {
    try {
      await run('which', [tool]);
    } catch {
      fail(tool === 'lame' ? 'LAME is not installed. Run: brew install lame' : 'This needs a Mac (the say command).');
    }
  }

  const model = buildModel(parseScript(readDocxParagraphs(new Uint8Array(await readFile(resolve(opt.script))))));
  if (!model.items.length) fail('No scenes found in that script.');
  const voicesFile = join(out, 'voices.json');
  const saved = existsSync(voicesFile) ? JSON.parse(await readFile(voicesFile, 'utf8')) : {};
  const speakers = new Set(model.items.map((it) => it.speaker));
  await mkdir(CACHE, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), 'off-script-audio-'));
  const listed = (await installedVoices()).filter((v) => ACCENTS.test(v.locale));
  const unique = [...new Map(listed.map((v) => [v.name, v])).values()];
  const speaking = await speakingVoices(unique, work);
  if (!speaking.length) {
    await rm(work, { recursive: true, force: true });
    fail('None of the Mac’s English voices made a sound. Check that speech works (say hello), then try again.');
  }
  const voices = chooseVoices(speakers, speaking, saved);
  await writeFile(voicesFile, JSON.stringify(voices, null, 2) + '\n');

  // Every clip the pack needs, once each.
  const jobs = [];
  const clip = (file, voice, text, silence = 0) => {
    const job = { file, voice, text, silence };
    jobs.push(job);
    return job;
  };
  const voiceOf = (speaker) => voices.speakers[speaker] || voices.narrator;
  const silence = clip('s250.mp3', 'silence', 'silence', 0.25);
  const items = {};
  for (const it of model.items) {
    items[it.id] = {
      line: clip(`l-${it.id}.mp3`, voiceOf(it.speaker), speakable(it.text)),
      cue: it.cue.speaker === null ? null : clip(`c-${it.id}.mp3`, voiceOf(it.cue.speaker), speakable(it.cue.text)),
    };
  }
  const names = {};
  for (const sp of speakers) names[sp] = clip(`p-${fnv1a(sp)}.mp3`, voices.narrator, speakable(sp));
  const headings = {};
  for (const sc of model.scenes) headings[sc.index] = clip(`h-${sc.index}.mp3`, voices.narrator, speakable(sc.heading));

  const files = {};
  let cachedCount = 0;
  let stoodIn = 0;
  if (speaking.length < unique.length) console.log(`${unique.length - speaking.length} of ${unique.length} voices made no sound, so they are not used this time.`);
  console.log(`Rendering ${jobs.length} clips for ${model.items.length} lines, ${speakers.size} speakers and ${model.scenes.length} scenes.`);
  // A cue is often the line before it, in the same voice: each different clip is made once, so two
  // jobs never write the same files at the same time.
  const renders = new Map();
  try {
    await pool(jobs, opt.jobs, async (job) => {
      const key = keyOf(job);
      if (!renders.has(key)) renders.set(key, render(job, work, voices.narrator));
      const r = await renders.get(key);
      job.duration = r.duration;
      files[job.file] = r.bytes;
      if (r.fromCache) cachedCount += 1;
      if (r.stoodIn) stoodIn += 1;
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  const ref = (job) => job && { file: job.file, duration: job.duration };
  const today = new Date();
  const manifest = {
    version: PACK_VERSION,
    scriptHash: model.hash,
    sampleRate: RATE,
    bitrate: BITRATE,
    made: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
    silence: ref(silence),
    items: Object.fromEntries(Object.entries(items).map(([id, x]) => [id, { line: ref(x.line), cue: ref(x.cue) }])),
    speakers: Object.fromEntries(Object.entries(names).map(([sp, j]) => [sp, ref(j)])),
    headings: Object.fromEntries(Object.entries(headings).map(([i, j]) => [i, ref(j)])),
  };
  files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
  const zip = zipSync(files, { level: 0 });
  const name = `Off Script audio pack ${today.getDate()} ${MONTHS[today.getMonth()]}.zip`;
  await writeFile(join(out, name), zip);
  const total = Object.values(items).reduce((n, x) => n + x.line.duration, 0);
  const length = total < 90 ? `${Math.round(total)} seconds` : `${Math.round(total / 60)} minutes`;
  console.log(`Done: ${jobs.length} clips (${cachedCount} from the cache), ${(zip.length / 1e6).toFixed(1)} MB, about ${length} of lines.`);
  if (stoodIn) console.log(`${stoodIn} clip${stoodIn === 1 ? '' : 's'} used the narrator’s voice because their own voice made no sound. Run it again later to redo ${stoodIn === 1 ? 'it' : 'them'}.`);
  console.log(`Written to the --out folder as "${name}", with voices.json beside it.`);
  return { name, manifest };
}

if (process.argv[1] && basename(process.argv[1]) === 'render-audio.mjs' && dirname(realpathSync(process.argv[1])) === join(REPO, 'tools')) {
  main(process.argv.slice(2)).catch((err) => fail(`Audio pack failed: ${err.message}`));
}
