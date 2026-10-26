// Checking answers. Type mode: one key per word, first letter or digit. A wrong key, or the ? key,
// shows the right word at once and marks it missed, so there is never any letter guessing.
// Say mode: after saying the line aloud he taps the words he missed or changed.

// The Type keypad's rows, each centred under the one above, keys of one width.
export const KEY_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm?'];
const KEY_AT = new Map(KEY_ROWS.flatMap((row, y) => [...row].map((k, i) => [k, { x: i + (10 - row.length) / 2, y }])));

// Two different keys that touch, side by side or diagonally: a slip of the finger from one to the
// other is easy.
export function neighbours(a, b) {
  const p = KEY_AT.get(a);
  const q = KEY_AT.get(b);
  return !!p && !!q && a !== b && Math.abs(p.y - q.y) <= 1 && Math.abs(p.x - q.x) <= 1;
}

export function createTypeCheck(tokens) {
  const keyed = [];
  tokens.forEach((t, i) => {
    if (t.k !== null) keyed.push(i);
  });
  let pos = 0;
  const misses = [];
  const slips = []; // missed with a key touching the right one: perhaps a slip of the finger

  const step = (correct, key = null) => {
    const index = keyed[pos];
    if (!correct) misses.push(index);
    if (!correct && key !== null && neighbours(key, tokens[index].k)) slips.push(index);
    pos += 1;
    return { index, correct, done: pos >= keyed.length };
  };

  return {
    get done() {
      return pos >= keyed.length;
    },
    // Tokens before this index are on show (words answered so far, plus any [direction] before the next word).
    get shownUpTo() {
      return pos >= keyed.length ? tokens.length : keyed[pos];
    },
    get misses() {
      return [...misses];
    },
    get slips() {
      return [...slips];
    },
    press(key) {
      if (pos >= keyed.length) return null;
      const k = String(key).toLowerCase();
      return step(k === tokens[keyed[pos]].k, k);
    },
    reveal() {
      if (pos >= keyed.length) return null;
      return step(false);
    },
  };
}

export function sayMisses(tokens, tapped) {
  return [...tapped].filter((i) => tokens[i] && tokens[i].k !== null).sort((a, b) => a - b);
}

// ms: from the answer starting (the keypad or Reveal on show) to the last key or Reveal. firstMs: to
// the first key (Type). slip: counted right by him after a slip of the finger.
export function makeResult({ misses, speakerWrong = false, mode, ms = null, firstMs = null, slip = false }) {
  const result = { pass: misses.length === 0 && !speakerWrong, misses, speakerWrong, mode };
  if (ms != null) result.ms = ms;
  if (firstMs != null) result.firstMs = firstMs;
  if (slip) result.slip = true;
  return result;
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const bare = (d) => d.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’]+$/gu, '');

// One plain sentence for the screen and for VoiceOver.
export function describeResult(result, tokens, speaker) {
  const parts = [];
  if (result.pass) return 'Word perfect';
  if (result.speakerWrong) parts.push(`It was ${speaker}`);
  const n = result.misses.length;
  if (n) {
    const count = n <= 10 ? NUMBER_WORDS[n] : String(n);
    const list = result.misses.slice(0, 5).map((i) => bare(tokens[i].d)).join(', ');
    parts.push(`${count} ${n === 1 ? 'miss' : 'misses'}: ${list}${n > 5 ? ' and more' : ''}`);
  }
  return parts.join('. ');
}
