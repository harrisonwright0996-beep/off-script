// Builds the learning model from parsed scenes: items (speeches or chunks of long speeches),
// beats (4 to 8 items), cues, stable ids, speech numbers and reader events.
import { tokenize, keyedCount } from './tokens.js';
import { normQuotes, displayTitle } from './parse.js';

export const MODEL_VERSION = 1;

export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (const ch of str) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const SMALL = new Set(['as', 'her', 'his']);
export function displayRole(role) {
  return normQuotes(role)
    .toLowerCase()
    .split(' ')
    .map((w, i) => {
      if (!w) return w;
      if (i > 0 && SMALL.has(w.replace(/[()]/g, ''))) return w;
      const j = w.search(/\p{L}/u);
      return j < 0 ? w : w.slice(0, j) + w[j].toUpperCase() + w.slice(j + 1);
    })
    .join(' ');
}

// Sentence ends are . ! or ? (with any closing quotes or brackets). An ellipsis is not an end:
// in this script it is usually a pause inside a thought.
export function splitSentences(text) {
  return text.split(/(?<=[.!?]["'”’)\]]*)\s+/).filter(Boolean);
}

const words = (s) => keyedCount(tokenize(s));

// A sentence longer than max words is split at commas, semicolons, colons or dashes,
// as near the middle as possible, so no card is a wall of words.
function splitLongSentence(s, max) {
  if (words(s) <= max) return [s];
  const parts = s.split(/(?<=[,;:–—])\s+/);
  if (parts.length < 2) return [s];
  const total = words(s);
  let best = 1;
  let bestGap = Infinity;
  let run = 0;
  for (let i = 1; i < parts.length; i++) {
    run += words(parts[i - 1]);
    const gap = Math.abs(total / 2 - run);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return [
    ...splitLongSentence(parts.slice(0, best).join(' '), max),
    ...splitLongSentence(parts.slice(best).join(' '), max),
  ];
}

export function chunkSpeech(text, { splitOver = 40, min = 15, max = 35 } = {}) {
  if (words(text) <= splitOver) return [text];
  const chunks = [];
  let cur = [];
  let n = 0;
  for (const s of splitSentences(text).flatMap((x) => splitLongSentence(x, max))) {
    const w = words(s);
    if (cur.length && n >= min && n + w > max) {
      chunks.push(cur.join(' '));
      cur = [];
      n = 0;
    }
    cur.push(s);
    n += w;
  }
  if (cur.length) {
    if (chunks.length && n < 6) chunks[chunks.length - 1] += ' ' + cur.join(' ');
    else chunks.push(cur.join(' '));
  }
  return chunks;
}

const stripParens = (s) => s.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
export const bracketParens = (s) => s.replace(/\(([^)]*)\)/g, (m, x) => `[${x.trim()}]`);

// The words another actor says just before an item: the last sentence (with the one before it
// when the last is under four words), at most 12 words. Directions inside the line are left out.
export function cueTail(text, maxWords = 12) {
  const spoken = stripParens(text) || bracketParens(text);
  const sentences = splitSentences(spoken);
  let ws = [];
  for (let i = sentences.length - 1; i >= 0 && ws.length < 4; i--) {
    ws = [...sentences[i].split(/\s+/).filter(Boolean), ...ws];
  }
  return ws.length <= maxWords ? ws.join(' ') : '…' + ws.slice(-maxWords).join(' ');
}

function noteFor(ev) {
  if (ev.t === 'dir') return `[${ev.text}]`;
  if (ev.t === 'placard') return `[Placard: ${ev.text}]`;
  if (ev.t === 'silent') return `[${displayRole(ev.role)}: ${ev.text.replace(/[()]/g, '').trim()}]`;
  return `[On screen, ${displayRole(ev.role || '')}: ${ev.lines.join(' ')}]`;
}

const squash = (s) => s.replace(/\s+/g, ' ').trim();

export function buildModel(parsed) {
  const items = [];
  const beats = [];
  const scenes = [];
  const seen = new Map();

  parsed.scenes.forEach((sc, si) => {
    const heading = sc.title ? `${sc.name}: ${sc.title}` : sc.name;
    const scene = { index: si, name: sc.name, title: sc.title, heading, itemIds: [], beatIds: [], words: 0, reader: [] };
    let speechNo = 0;
    let between = []; // things seen or done since the last spoken item: they go in the next cue
    let prev = null;

    for (const ev of sc.events) {
      if (ev.t !== 'speech' || ev.screen) {
        between.push(ev);
        scene.reader.push(
          ev.t === 'speech'
            ? { t: 'screen', speaker: displayRole(ev.role || ''), text: squash(ev.lines.join(' ')) }
            : { t: ev.t, text: squash(ev.text) },
        );
        continue;
      }
      speechNo += 1;
      const text = squash(ev.lines.join(' '));
      const speaker = displayRole(ev.role);
      if (keyedCount(tokenize(text)) === 0) {
        // A speech that is only a direction, such as "(Nods.)": shown, never tested.
        between.push({ t: 'silent', role: ev.role, text });
        scene.reader.push({ t: 'speech', n: speechNo, speaker, text, itemIds: [] });
        continue;
      }
      const ids = [];
      chunkSpeech(text).forEach((part, pi, parts) => {
        const key = `${si}|${normQuotes(ev.role).toUpperCase()}|${normQuotes(part)}`;
        const occ = (seen.get(key) || 0) + 1;
        seen.set(key, occ);
        const tokens = tokenize(part);
        const notes = (pi === 0 ? between : []).map(noteFor);
        const item = {
          id: fnv1a(`${key}|${occ}`),
          scene: si,
          n: speechNo,
          part: pi,
          parts: parts.length,
          role: ev.role,
          speaker,
          text: part,
          tokens,
          words: keyedCount(tokens),
          askSpeaker: pi === 0,
          cue: prev
            ? { speaker: prev.speaker, text: cueTail(prev.text), notes: notes.slice(-2) }
            : { speaker: null, text: heading, notes: notes.slice(0, 2) },
          beat: null,
          index: items.length,
        };
        items.push(item);
        scene.itemIds.push(item.id);
        scene.words += item.words;
        ids.push(item.id);
        prev = item;
      });
      between = [];
      scene.reader.push({ t: 'speech', n: speechNo, speaker, text, itemIds: ids });
    }

    const sceneItems = items.slice(items.length - scene.itemIds.length);
    for (const group of makeBeats(sceneItems)) {
      const beat = { id: 'b' + group[0].id, scene: si, itemIds: group.map((it) => it.id), words: group.reduce((n, it) => n + it.words, 0) };
      group.forEach((it) => (it.beat = beat.id));
      beats.push(beat);
      scene.beatIds.push(beat.id);
    }
    scenes.push(scene);
  });

  return {
    version: MODEL_VERSION,
    hash: fnv1a(items.map((it) => it.id).join(',')),
    scenes,
    items,
    beats,
    totals: {
      speeches: scenes.reduce((n, s) => n + s.reader.filter((r) => r.t === 'speech').length, 0),
      words: items.reduce((n, it) => n + it.words, 0),
      items: items.length,
      beats: beats.length,
    },
  };
}

// Beats: 4 to 8 items, about 100 words at most, breaking where a direction falls.
export function makeBeats(sceneItems) {
  const groups = [];
  let cur = [];
  let curWords = 0;
  for (const it of sceneItems) {
    const directionBefore = it.part === 0 && it.cue.notes.length > 0;
    const full = cur.length >= 8 || (cur.length >= 2 && curWords + it.words > 100);
    if (full || (cur.length >= 4 && directionBefore)) {
      groups.push(cur);
      cur = [];
      curWords = 0;
    }
    cur.push(it);
    curWords += it.words;
  }
  if (cur.length) {
    const last = groups[groups.length - 1];
    const lastWords = last ? last.reduce((n, it) => n + it.words, 0) : 0;
    if (last && cur.length < 3 && last.length + cur.length <= 10 && lastWords + curWords <= 120) last.push(...cur);
    else groups.push(cur);
  }
  return groups;
}

// Lookups used everywhere. cues: the lines whose cue is made longer (uniqueCues).
export function indexModel(model) {
  const byId = new Map(model.items.map((it) => [it.id, it]));
  const beatById = new Map(model.beats.map((b) => [b.id, b]));
  return { byId, beatById, cues: uniqueCues(model) };
}

// The cue to show or play for a line: made longer if it would lead to more than one line.
export const cueOf = (index, item) => (index.cues && index.cues.get(item.id)) || item.cue;

export const CUE_LINES = 3; // lines before a line that a longer cue may show
const flat = (s) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();

// Cues with one right answer. Plays repeat themselves, so the same cue can lead to different lines,
// and a check from it alone would have two right answers. Such a line's cue shows the lines before
// it in full, led by the first one's own cue, as few as make it the only line that fits (at most
// three). If even that leaves an exchange that repeats word for word, the cue also says which time
// it comes. Worked out from the saved model whenever it is indexed, so nothing is imported again.
// Returns a map of id to { ...cue, lead: [ids shown in full], lines: [{ speaker, text }], nth }.
export function uniqueCues(model) {
  const { items } = model;
  const said = (cue) => `${cue.speaker ?? ''}|${flat(cue.text)}`;
  const line = (x) => `${x.speaker}|${flat(x.text)}`; // who says it and what: the same words from someone else are another line
  // What comes before line i: its own cue (n = 0), or the cue of the line n back and the lines from
  // there in full. null once that would run back past the start of the scene.
  const before = (i, n) => {
    if (n === 0) return said(items[i].cue);
    const j = i - n;
    if (j < 0 || items[j].scene !== items[i].scene) return null;
    return [said(items[j].cue), ...items.slice(j, i).map(line)].join('/');
  };
  const groups = new Map();
  items.forEach((it, i) => {
    if (it.cue.speaker === null) return; // a scene opening: its cue is the scene
    const key = before(i, 0);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  const cues = new Map();
  for (const group of groups.values()) {
    if (new Set(group.map((i) => line(items[i]))).size < 2) continue; // every line it leads to is the same
    for (const i of group) {
      const rivals = group.filter((j) => line(items[j]) !== line(items[i]));
      let n = 0;
      let unique = false;
      while (!unique && n < CUE_LINES && before(i, n + 1) !== null) {
        n += 1;
        const mine = before(i, n);
        unique = rivals.every((j) => before(j, n) !== mine);
      }
      const lead = items.slice(i - n, i);
      const cue = {
        ...items[i].cue,
        lead: lead.map((x) => x.id),
        lines: [{ speaker: lead[0].cue.speaker, text: lead[0].cue.text }, ...lead.map((x) => ({ speaker: x.speaker, text: x.text }))],
      };
      if (!unique) {
        // The card names the scene, so only repeats in the same scene need telling apart.
        const same = group.filter((j) => items[j].scene === items[i].scene && before(j, n) === before(i, n));
        if (same.length > 1) cue.nth = same.indexOf(i) + 1;
      }
      cues.set(items[i].id, cue);
    }
  }
  return cues;
}

// The first spoken item of every scene that has one.
export function spineItemIds(model) {
  return model.scenes.filter((s) => s.itemIds.length).map((s) => s.itemIds[0]);
}

// Up to six speaker choices: the right one plus nearby speakers in the same scene, sorted A to Z
// so position gives nothing away.
export function speakerChoices(model, item, count = 6, byId = indexModel(model).byId) {
  const scene = model.scenes[item.scene];
  const pos = scene.itemIds.indexOf(item.id);
  const nearby = [];
  for (let d = 1; d < scene.itemIds.length && nearby.length < 40; d++) {
    for (const j of [pos - d, pos + d]) {
      const it = byId.get(scene.itemIds[j]);
      if (it && it.speaker !== item.speaker && !nearby.includes(it.speaker)) nearby.push(it.speaker);
    }
  }
  const picked = [item.speaker, ...nearby.slice(0, count - 1)];
  return picked.sort((a, b) => a.localeCompare(b, 'en-GB'));
}

export { displayTitle };
