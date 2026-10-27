// Splits a line into tokens for checking and display.
// Each token: { d: display text, a: what follows it (' ', '-' or ''), k: key or null }.
// k is the lower case first letter or digit that the learner taps; null means "shown, not tested"
// (parenthetical directions and stray punctuation).

const ALNUM = /[\p{L}\p{N}]/u;
const PAREN = /\([^)]*\)/g;
const DASH_BETWEEN = /(?<=[\p{L}\p{N}])[-‐‑–—](?=[\p{L}\p{N}])/u;

export function keyOf(word) {
  const m = word.match(ALNUM);
  if (!m) return null;
  const base = m[0].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return base === 'ı' ? 'i' : base[0];
}

export function tokenize(text) {
  const tokens = [];
  const pieces = [];
  let last = 0;
  for (const m of text.matchAll(PAREN)) {
    if (m.index > last) pieces.push({ text: text.slice(last, m.index) });
    pieces.push({ text: m[0], paren: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last) });

  for (const piece of pieces) {
    if (piece.paren) {
      tokens.push({ d: `[${piece.text.slice(1, -1).trim()}]`, a: ' ', k: null });
      continue;
    }
    for (const chunk of piece.text.split(/\s+/).filter(Boolean)) {
      const parts = splitOnDashes(chunk);
      parts.forEach((part, i) => {
        const after = i < parts.length - 1 ? part.dash : ' ';
        const k = keyOf(part.text);
        if (k === null && tokens.length && tokens[tokens.length - 1].k !== null) {
          const prev = tokens[tokens.length - 1];
          prev.d += (prev.a === ' ' ? ' ' : prev.a) + part.text; // stray punctuation joins the word before
          prev.a = after;
          return;
        }
        tokens.push({ d: part.text, a: after, k });
      });
    }
  }
  if (tokens.length) tokens[tokens.length - 1].a = '';
  return tokens;
}

function splitOnDashes(chunk) {
  const parts = [];
  let rest = chunk;
  let m;
  while ((m = rest.match(DASH_BETWEEN))) {
    parts.push({ text: rest.slice(0, m.index), dash: m[0] });
    rest = rest.slice(m.index + 1);
  }
  parts.push({ text: rest, dash: '' });
  return parts;
}

export function keyedCount(tokens) {
  return tokens.filter((t) => t.k !== null).length;
}

// The punctuation after a word's last letter or digit. An apostrophe on its own (goin’, the
// students’) is part of the word.
function tailOf(text) {
  const m = text.match(/[^\p{L}\p{N}]+$/u);
  return m && !/^['’]+$/u.test(m[0]) ? m[0] : '';
}

// The Session 10 "back of the sheet" view: first letters, keeping capitals and punctuation;
// numbers stay as written.
export function firstLettersOf(token) {
  if (token.k === null) return token.d;
  const i = token.d.search(ALNUM);
  const first = token.d[i];
  if (/\p{N}/u.test(first)) return token.d;
  return token.d.slice(0, i) + first + tailOf(token.d.slice(i + 1));
}

export function joinTokens(tokens, view = (t) => t.d) {
  return tokens.map((t, i) => view(t, i) + (i < tokens.length - 1 ? t.a : '')).join('');
}

export function firstLettersLine(tokens) {
  return joinTokens(tokens, firstLettersOf);
}

// A word whose first letter is not shown: a blank, keeping the word's punctuation, as the first
// letters do. A direction is shown as it is.
export function blankOf(token) {
  if (token.k === null) return token.d;
  const i = token.d.search(ALNUM);
  return token.d.slice(0, i) + '_' + tailOf(token.d.slice(i + 1));
}

// Where a phrase starts: at the first word, after a word ending in a pause (a comma, full stop or
// other stop, a closing bracket or quote, or a dash, with any closing single quote after it), after
// a dash between two words (not a hyphen), at a dash joined to the next word, and after a direction.
// In a long phrase every seventh word starts again, so that no more than six blanks come in a row.
// Token indices.
const PAUSE = /[,;:.!?…)\]"”—–-]['’]*$/u;
const DASH = /[–—]/u;
const LEAD_DASH = /^[-–—]/u;
export const MAX_BLANKS = 6;

export function phraseStarts(tokens) {
  const starts = new Set();
  let start = true;
  let run = 0;
  tokens.forEach((t, i) => {
    if (t.k === null) {
      start = true;
      return;
    }
    if (start || run >= MAX_BLANKS || LEAD_DASH.test(t.d)) {
      starts.add(i);
      run = 0;
    } else run += 1;
    start = PAUSE.test(t.d) || DASH.test(t.a);
  });
  return starts;
}

// The words a first letters go shows a letter for (session.js chooses the level): 'all' every word,
// 'phrases' the first word of each phrase, 'missed' the first word and the words missed before
// (token indices). The others are blanks.
export function lettersShown(tokens, level, missedBefore = []) {
  const keyed = (i) => i >= 0 && i < tokens.length && tokens[i].k !== null;
  if (level === 'phrases') return phraseStarts(tokens);
  if (level === 'missed') return new Set([tokens.findIndex((t) => t.k !== null), ...missedBefore].filter(keyed));
  return new Set(tokens.map((t, i) => i).filter(keyed));
}
