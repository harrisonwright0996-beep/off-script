// The Type mode keypad, never the phone's own keyboard: a slim row of digits, three QWERTY rows
// and ?. One tap per word: its first letter or digit. ? shows the next word, which counts as a miss.
// A hardware keyboard works too.
import { h } from './dom.js';

const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm?'];

export function keypad(onKey) {
  const el = h(
    'div',
    { class: 'keypad', role: 'group', 'aria-label': 'Keypad: tap the first letter of each word' },
    ROWS.map((row, i) =>
      h(
        'div',
        { class: i === 0 ? 'keys digits' : 'keys' },
        [...row].map((k) =>
          h('button', { type: 'button', class: k === '?' ? 'key reveal' : 'key', 'aria-label': k === '?' ? 'Show the next word' : k, dataset: { key: k } }, k),
        ),
      ),
    ),
  );
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-key]');
    if (b) onKey(b.dataset.key);
  });
  const onKeydown = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !el.isConnected) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : '';
    if (/^[a-z0-9?]$/.test(k)) {
      e.preventDefault();
      onKey(k);
    }
  };
  document.addEventListener('keydown', onKeydown);
  return { el, remove: () => document.removeEventListener('keydown', onKeydown) };
}
