// Checking answers. Type mode: one key per word, first letter or digit. A wrong key, or the ? key,
// shows the right word at once and marks it missed, so there is never any letter guessing.
// Say mode: after saying the line aloud he taps the words he missed or changed.

export function createTypeCheck(tokens) {
  const keyed = [];
  tokens.forEach((t, i) => {
    if (t.k !== null) keyed.push(i);
  });
  let pos = 0;
  const misses = [];

  const step = (correct) => {
    const index = keyed[pos];
    if (!correct) misses.push(index);
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
    press(key) {
      if (pos >= keyed.length) return null;
      return step(String(key).toLowerCase() === tokens[keyed[pos]].k);
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

export function makeResult({ misses, speakerWrong = false, mode }) {
  return { pass: misses.length === 0 && !speakerWrong, misses, speakerWrong, mode };
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
