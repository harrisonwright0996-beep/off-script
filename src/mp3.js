// Reads the frames of constant bit rate MP3 clips so they can be joined byte for byte into
// one file, with exact times worked out from frame counts. Clips come from LAME run with -t
// (no info frame); tags and info frames are skipped anyway.

const KBPS = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], // MPEG 1 Layer III
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], // MPEG 2 and 2.5 Layer III
};
const RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };

export function frameHeader(u8, i) {
  if (u8[i] !== 0xff || (u8[i + 1] & 0xe0) !== 0xe0) return null;
  const vbits = (u8[i + 1] >> 3) & 3;
  const layer = (u8[i + 1] >> 1) & 3;
  if (vbits === 1 || layer !== 1) return null; // reserved version, or not Layer III
  const version = vbits === 3 ? 1 : vbits === 2 ? 2 : 2.5;
  const bi = u8[i + 2] >> 4;
  const si = (u8[i + 2] >> 2) & 3;
  if (bi === 0 || bi === 15 || si === 3) return null;
  const bitrate = KBPS[version === 1 ? 1 : 2][bi] * 1000;
  const sampleRate = RATES[version][si];
  const samples = version === 1 ? 1152 : 576;
  const padding = (u8[i + 2] >> 1) & 1;
  const channels = u8[i + 3] >> 6 === 3 ? 1 : 2;
  return { version, bitrate, sampleRate, samples, channels, length: Math.floor(((samples / 8) * bitrate) / sampleRate) + padding };
}

function id3v2Length(u8) {
  if (u8[0] !== 0x49 || u8[1] !== 0x44 || u8[2] !== 0x33) return 0; // "ID3"
  const size = ((u8[6] & 0x7f) << 21) | ((u8[7] & 0x7f) << 14) | ((u8[8] & 0x7f) << 7) | (u8[9] & 0x7f);
  return 10 + size + (u8[5] & 0x10 ? 10 : 0);
}

function isInfoFrame(u8, i, h) {
  const side = h.version === 1 ? (h.channels === 1 ? 17 : 32) : h.channels === 1 ? 9 : 17;
  const tag = String.fromCharCode(...u8.subarray(i + 4 + side, i + 8 + side));
  return tag === 'Xing' || tag === 'Info';
}

// One clip: its audio frames only, and its exact length in seconds.
export function parseMp3(u8) {
  let i = id3v2Length(u8);
  let first = null;
  let start = -1;
  let frames = 0;
  while (i + 4 <= u8.length) {
    const h = frameHeader(u8, i);
    if (!h || i + h.length > u8.length) break; // an ID3v1 "TAG", or the end
    if (first === null && isInfoFrame(u8, i, h)) {
      i += h.length;
      continue;
    }
    if (first === null) {
      first = h;
      start = i;
    } else if (h.sampleRate !== first.sampleRate || h.channels !== first.channels) break;
    frames += 1;
    i += h.length;
  }
  if (first === null) throw new Error('not-mp3');
  return {
    bytes: u8.subarray(start, i),
    frames,
    sampleRate: first.sampleRate,
    channels: first.channels,
    bitrate: first.bitrate,
    duration: (frames * first.samples) / first.sampleRate,
  };
}

// Joins byte arrays into one (for tests and for building a Blob's single part).
export function concatBytes(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
