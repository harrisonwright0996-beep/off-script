// Already know some? A typed check of lines not yet learned, scene by scene, so he need not start from
// the top. Each line gets one try. Right: the line is not taught, and comes back as a check. Wrong:
// nothing is held against it, and it is taught as new. Two misses in a row end that scene.
import { h, clear, screen, button, announce, focusHeading, plural, settled } from './dom.js';
import { createTypeCheck, makeResult } from '../grade.js';
import { keypad, TYPE_HINT } from './keypad.js';
import { cueBlock, keepInView, tokenView } from './sprint.js';
import { cueOf } from '../items.js';
import { applyKnown } from '../state.js';
import { dayKey } from '../dates.js';

const STOP_AFTER = 2; // misses in a row that end a scene
const TRIED = 'checkTried'; // the ids of lines already tried here

export const linesToCheck = (model, getState, tried = new Set()) => model.items.filter((it) => getState(it.id).status === 'new' && !tried.has(it.id)).map((it) => it.id);

export async function showCheckin(ctx) {
  let removeKeys = null;
  const quiet = () => {
    if (removeKeys) removeKeys();
    removeKeys = null;
  };
  const show = (title, body, footer, footerClass = '') => {
    quiet();
    clear(ctx.root).append(screen({ title, body, footer, footerClass, back: settled(() => ctx.go('today')) }));
    window.scrollTo(0, 0); // each line starts at its cue
    focusHeading(ctx.root);
  };

  const tried = new Set((await ctx.store.get(TRIED)) || []);
  const queue = linesToCheck(ctx.model, ctx.getState, tried);
  let right = 0;
  let last = null; // how the line before went: { pass, text }

  // A key on a line uses its one try, so leaving part way cannot save it for another go.
  function markTried(id) {
    if (tried.has(id)) return;
    tried.add(id);
    ctx.store.set(TRIED, [...tried]);
  }

  // How the line before went, on the screen that follows it, and said aloud.
  function lastResult() {
    if (!last) return null;
    announce(last.text);
    return h('p', { class: `result ${last.pass ? 'perfect' : 'misses'}` }, h('span', { class: 'icon', 'aria-hidden': 'true' }, last.pass ? '✓' : '✕'), h('span', {}, last.text));
  }

  function ask() {
    if (!queue.length) {
      return show('Already know some?', [h('p', { class: 'lead' }, 'You have checked all you can.'), h('p', {}, 'Each line gets one try, and the rest are ready for you to learn.')], [button('Back to Today', settled(() => ctx.go('today')), { class: 'btn primary' })]);
    }
    show(
      'Already know some?',
      [
        h('p', { class: 'lead' }, 'Check what you know, and skip what you have already learned.'),
        h('p', {}, 'You get each cue, and you type the first letter of every word. Each line gets one try. Any you get right are not taught, and come back as checks. The rest you will just learn.'),
      ],
      [button('Yes, check what I know', settled(() => next(0, 0)), { class: 'btn primary' }), button('Not now', settled(() => ctx.go('today')))],
    );
  }

  function next(pos, missesInRow) {
    if (pos >= queue.length) return finish();
    const item = ctx.index.byId.get(queue[pos]);
    const tokens = item.tokens;
    const check = createTypeCheck(tokens);
    const line = h('p', { class: 'line answer' });
    const draw = () => clear(line).append(...tokenView(tokens, check.shownUpTo, new Set(check.misses)));
    draw();
    const pad = keypad((key) => {
      const r = key === '?' ? check.reveal() : check.press(key);
      if (!r) return;
      markTried(item.id);
      hint.remove();
      draw();
      keepInView(ctx.root, line.lastElementChild || line);
      announce(`${r.correct ? '' : 'Missed: '}${tokens[r.index].d}`);
      if (!r.done) return;
      quiet();
      saved(pos, missesInRow, item, makeResult({ misses: check.misses, mode: 'type', words: ctx.settings.closeLines ? item.words : 0 }));
    });
    const hint = h('p', { class: 'help type-hint' }, TYPE_HINT);
    const cue = cueOf(ctx.index, item);
    show(
      ctx.model.scenes[item.scene].heading,
      [lastResult(), h('p', { class: 'where' }, `Checking your lines: ${pos + 1} of ${queue.length}`), cueBlock(ctx, item, cue), h('p', { class: 'speaker' }, item.speaker), hint, line, button('That is enough, teach me', settled(finish), { class: 'btn link' })],
      [pad.el],
      'keyboard',
    );
    removeKeys = pad.remove;
    keepInView(ctx.root, hint);
  }

  async function saved(pos, missesInRow, item, result) {
    if (result.pass) {
      right += 1;
      const time = Date.now();
      const prev = ctx.getState(item.id);
      const state = applyKnown(prev, { day: dayKey(new Date(time)), time, closeWord: result.misses[0] ?? null });
      const missed = result.misses.length ? { missed: [...result.misses] } : {};
      await ctx.saveAnswer({ event: { time, day: state.lastDay, id: item.id, pass: true, mode: 'type', queue: 'known', misses: result.misses.length, speakerWrong: false, relearn: false, prev, ...missed }, state });
    }
    const inRow = result.pass ? 0 : missesInRow + 1;
    last = { pass: result.pass, text: !result.pass ? 'Not this one yet. You will learn it.' : result.misses.length ? 'Nearly word perfect.' : 'Word perfect.' };
    if (inRow < STOP_AFTER) return next(pos + 1, inRow);
    const skip = queue.findIndex((id, i) => i > pos && ctx.index.byId.get(id).scene !== item.scene);
    const to = skip < 0 ? queue.length : skip;
    if (to > pos + 1) last.text += ' That is two in a row, so we will skip the rest of this scene.';
    next(to, 0);
  }

  function finish() {
    show(
      'All checked',
      [
        lastResult(),
        h('p', { class: 'lead' }, right ? `You already know ${plural(right, 'line')}.` : 'No problem. You will learn them all from here.'),
        right ? h('p', {}, 'These lines will not need teaching. They come back as checks, to make sure they have stayed.') : null,
      ],
      [button('Back to Today', settled(() => ctx.go('today')), { class: 'btn primary' })],
    );
  }

  ask();
  return quiet;
}
