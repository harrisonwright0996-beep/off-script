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

// The Session 10 "back of the sheet" view: first letters, keeping capitals and punctuation;
// numbers stay as written.
export function firstLettersOf(token) {
  if (token.k === null) return token.d;
  const i = token.d.search(ALNUM);
  const first = token.d[i];
  if (/\p{N}/u.test(first)) return token.d;
  const lead = token.d.slice(0, i);
  const tail = token.d.slice(i).match(/[^\p{L}\p{N}'’]+$/u);
  return lead + first + (tail ? tail[0] : '');
}

export function joinTokens(tokens, view = (t) => t.d) {
  return tokens.map((t, i) => view(t) + (i < tokens.length - 1 ? t.a : '')).join('');
}

export function firstLettersLine(tokens) {
  return joinTokens(tokens, firstLettersOf);
}
