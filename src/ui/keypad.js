// The Type mode keypad, never the phone's own keyboard: a slim row of digits, three QWERTY rows
// and ?. One tap per word: its first letter or digit. ? shows the next word, which counts as a miss.
// A hardware keyboard works too.
import { h } from './dom.js';
import { KEY_ROWS as ROWS } from '../grade.js';

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
  // On a touch screen a key types as the finger lifts, and the touch goes no further: two quick taps
  // on one key could otherwise be taken as a double tap to zoom, and the next tap land on the wrong
  // key. Each finger lifted counts, so two thumbs can type at once. Clicks still work, for VoiceOver,
  // a mouse or a keyboard.
  el.addEventListener('touchend', (e) => {
    const keys = [...e.changedTouches].map((t) => t.target.closest && t.target.closest('button[data-key]')).filter(Boolean);
    if (!keys.length) return;
    e.preventDefault();
    for (const b of keys) onKey(b.dataset.key);
  });
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
