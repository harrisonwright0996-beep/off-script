// The sprint: one card at a time from the session (session.js), answered on the keypad (Type) or by
// tapping the words missed (Say). Every answer is saved at once, and so is the sprint, so closing
// the app loses nothing. Time is a slim bar that only moves when he does something.
import { h, clear, screen, button, announce, focusHeading, num, plural } from './dom.js';
import { createSession } from '../session.js';
import { createTypeCheck, sayMisses, makeResult, describeResult } from '../grade.js';
import { firstLettersLine } from '../tokens.js';
import { canSpeak, speak, stopSpeaking } from '../tts.js';
import { untilText } from '../plan.js';
import { keypad } from './keypad.js';

const SAVED = 'sprint';
const IDLE_CAP = 150000; // a longer pause between taps was a break: it is not counted as sprint time
const AUTO_ADVANCE_MS = 1200;

// The line as it has been answered so far, misses marked with a cross as well as colour.
export function tokenView(tokens, upTo = tokens.length, misses = new Set()) {
  const out = [];
  for (let i = 0; i < upTo; i++) {
    const t = tokens[i];
    if (misses.has(i)) {
      out.push(h('span', { class: 'tok miss' }, t.d, h('span', { class: 'cross', 'aria-hidden': 'true' }, '✕'), h('span', { class: 'visually-hidden' }, ' (missed)')));
    } else out.push(h('span', { class: t.k === null ? 'tok note' : 'tok' }, t.d));
    out.push(t.a);
  }
  return out;
}

export function statsLine(st) {
  const parts = [`${plural(st.answered, 'answer')}, ${num(st.perfect)} word perfect.`];
  if (st.learnedItems) parts.push(`${plural(st.learnedItems, 'line')} learned (${plural(st.learnedWords, 'word')}).`);
  return parts.join(' ');
}

const minus = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] - (b[k] || 0)]));

// scope: 'all' or 'tests' (Just 2 minutes). minutes: the sprint length (settings by default).
// custom: { scene, itemIds } for Run this scene. extra: 'new' or 'runs' to keep going after the plan.
export async function showSprint(ctx, { scope = 'all', minutes = null, custom = null, extra = null } = {}) {
  const today = ctx.today();
  const length = (minutes ?? ctx.settings.sprintMinutes) * 60000;
  const short = minutes != null && minutes <= 2;
  const resumable = scope === 'all' && !custom;
  const saved = resumable ? await ctx.store.get(SAVED) : null;
  const usable = !!saved && saved.day === today && saved.hash === ctx.model.hash;
  ctx.refit();

  const session = createSession({
    model: ctx.model,
    index: ctx.index,
    getPlan: () => ctx.plan(),
    getState: ctx.getState,
    settings: ctx.settings,
    scope,
    custom,
    saved: usable ? saved.state : null,
  });
  const startStats = { ...session.stats };
  const undo = [];
  let elapsed = usable ? saved.elapsed || 0 : 0;
  let last = Date.now();
  let mode = ctx.settings.mode;
  let removeKeys = null;
  let autoTimer = null;
  let breakTimer = null;
  let finished = false;

  const heading = (scene) => ctx.model.scenes[scene].heading;

  const tick = () => {
    const now = Date.now();
    if (document.visibilityState === 'visible') elapsed += Math.min(now - last, IDLE_CAP);
    last = now;
  };
  const timeUp = () => elapsed >= length;

  async function saveSprint() {
    if (!resumable) return;
    await ctx.store.set(SAVED, { day: today, hash: ctx.model.hash, state: session.save(), elapsed: finished ? 0 : elapsed });
  }

  function quiet() {
    if (removeKeys) removeKeys();
    removeKeys = null;
    clearTimeout(autoTimer);
    autoTimer = null;
    stopSpeaking();
  }

  function timeBar() {
    const left = Math.max(0, length - elapsed);
    const fill = h('div', { class: 'timebar-fill', style: { width: `${(100 * left) / length}%` } });
    const mins = Math.max(1, Math.ceil(left / 60000));
    return h('div', { class: 'timebar', role: 'img', 'aria-label': `Sprint time: about ${plural(mins, 'minute')} left` }, fill);
  }

  function where(c) {
    const it = c.item;
    const part = it.parts > 1 ? `, part ${it.part + 1} of ${it.parts}` : '';
    if (c.progress) return h('p', { class: 'where' }, `Line ${c.progress.pos} of ${c.progress.total}, speech ${it.n}${part}`);
    return h('p', { class: 'where' }, `${heading(it.scene)}, speech ${it.n}${part}`);
  }

  function cueBlock(cue) {
    const line =
      cue.speaker === null ? h('p', {}, `Start of ${cue.text}`) : h('p', {}, h('strong', {}, cue.speaker), ': ', cue.text);
    return h('div', { class: 'cue' }, h('p', { class: 'cue-label' }, 'Cue'), line, cue.notes.map((n) => h('p', { class: 'note' }, n)));
  }

  const readAloud = (text) =>
    canSpeak() ? button('Read aloud', () => speak(text, { voiceURI: ctx.settings.voiceURI, rate: ctx.settings.rate })) : null;

  // Draws a card: the bar, where it is, any message, then the card's own content and actions.
  function frame(c, content, footer, footerClass = '') {
    quiet();
    const actions = undo.length ? [button('Undo', doUndo, { class: 'btn link', aria: 'Undo last answer' })] : [];
    const body = [timeBar(), where(c), c.message ? h('p', { class: 'message', role: 'status' }, c.message) : null, ...content];
    clear(ctx.root).append(screen({ title: c.label, back: stop, backLabel: 'Stop', actions, body, footer, footerClass, className: 'sprint' }));
  }

  function showCard(c, focus = true) {
    ctx.card = c; // the card on show, for browser tests
    if (c.step === 'test') {
      frame(c, [cueBlock(c.cue), h('p', { class: 'prompt' }, 'Do you know the next line?')], [
        button('Try it', () => choose('try'), { class: 'btn primary' }),
        button('Teach me', () => choose('teach')),
      ]);
    } else if (c.step === 'front') {
      frame(
        c,
        [cueBlock(c.cue), h('p', { class: 'speaker' }, c.item.speaker), h('p', { class: 'line' }, tokenView(c.item.tokens)), h('p', { class: 'prompt' }, c.prompt)],
        [button('Next', () => choose('next'), { class: 'btn primary' }), readAloud(c.item.text)].filter(Boolean),
      );
    } else if (c.step === 'back') {
      const words = h('p', { class: 'line help', hidden: true }, tokenView(c.item.tokens));
      const show = button('Show words', () => {
        words.hidden = !words.hidden;
        show.setAttribute('aria-pressed', String(!words.hidden));
      }, { pressed: 'false' });
      frame(
        c,
        [cueBlock(c.cue), h('p', { class: 'speaker' }, c.item.speaker), h('p', { class: 'line' }, firstLettersLine(c.item.tokens)), words, h('p', { class: 'prompt' }, 'Say it aloud from the first letters.')],
        [button('Next', () => choose('next'), { class: 'btn primary' }), show],
      );
    } else floor(c);
    if (focus) focusHeading(ctx.root);
  }

  async function choose(action) {
    tick();
    const c = session.choose(action);
    await saveSprint();
    showCard(c);
  }

  // Floor: from the cue alone. Who's next first (when the speaker changes), then the line.
  function floor(c) {
    const item = c.item;
    const tokens = item.tokens;
    let speakerWrong = false;
    const speakerArea = h('div', { class: 'speaker-area' });
    const answerArea = h('div', { class: 'answer-area', role: 'group', tabindex: '-1', 'aria-label': 'Your line' });
    const footBox = h('div', { class: 'stack-foot' });
    const switchMode = button(mode === 'type' ? 'Say it instead' : 'Type it instead', () => {
      mode = mode === 'type' ? 'say' : 'type';
      ctx.saveSettings({ mode });
      floor(c);
      focusHeading(ctx.root);
    }, { class: 'btn link' });

    frame(c, [cueBlock(c.cue), speakerArea, answerArea, switchMode], [footBox]);
    const foot = ctx.root.querySelector('footer');

    const startAnswer = () => (mode === 'type' ? typeAnswer() : sayAnswer());

    if (c.askSpeaker) {
      speakerArea.append(h('p', { class: 'prompt', id: 'who' }, 'Who speaks next?'));
      const chips = h('div', { class: 'chips', role: 'group', 'aria-labelledby': 'who' });
      for (const name of c.choices) {
        chips.append(
          button(name, () => {
            speakerWrong = name !== item.speaker;
            for (const b of chips.querySelectorAll('button')) {
              b.disabled = true;
              if (b.textContent === item.speaker) {
                b.classList.add('right');
                b.append(h('span', { 'aria-hidden': 'true' }, ' ✓'), h('span', { class: 'visually-hidden' }, ' (right)'));
              } else if (b.textContent === name) {
                b.classList.add('wrong');
                b.append(h('span', { class: 'visually-hidden' }, ' (your choice)'));
              }
            }
            announce(speakerWrong ? `It was ${item.speaker}` : item.speaker);
            startAnswer();
            answerArea.focus({ preventScroll: true });
          }, { class: 'btn chip' }),
        );
      }
      speakerArea.append(chips);
      footBox.append(h('p', { class: 'help' }, 'Choose who speaks, then say or type the line.'));
    } else {
      speakerArea.append(h('p', { class: 'speaker' }, item.part > 0 ? `${item.speaker}, continuing` : item.speaker));
      startAnswer();
    }

    function typeAnswer() {
      const check = createTypeCheck(tokens);
      const line = h('p', { class: 'line answer' });
      const hint = h('p', { class: 'help' }, 'Tap the first letter of each word. ? shows the next word.');
      const draw = () => clear(line).append(...tokenView(tokens, check.shownUpTo, new Set(check.misses)));
      draw();
      answerArea.append(line, hint);
      const pad = keypad((key) => {
        const r = key === '?' ? check.reveal() : check.press(key);
        if (!r) return;
        hint.remove();
        draw();
        announce(`${r.correct ? '' : 'Missed: '}${tokens[r.index].d}`);
        if (r.done) finish(c, makeResult({ misses: check.misses, speakerWrong, mode: 'type' }));
      });
      removeKeys = pad.remove;
      clear(footBox).append(pad.el);
      foot.className = 'foot keyboard';
    }

    function sayAnswer() {
      answerArea.append(h('p', { class: 'prompt' }, 'Say it aloud, then reveal it.'));
      clear(footBox).append(
        button('Reveal', () => {
          const tapped = new Set();
          const words = h('div', { class: 'words', role: 'group', 'aria-label': 'Tap any word you missed or changed' });
          tokens.forEach((t, i) => {
            if (t.k === null) {
              words.append(h('span', { class: 'word note-word' }, t.d));
              return;
            }
            const b = button(t.d, () => {
              if (tapped.has(i)) tapped.delete(i);
              else tapped.add(i);
              b.setAttribute('aria-pressed', String(tapped.has(i)));
            }, { class: 'word', pressed: 'false' });
            words.append(b);
          });
          clear(answerArea).append(h('p', { class: 'prompt' }, 'Tap any word you missed or changed.'), words);
          clear(footBox).append(
            button('Done', () => finish(c, makeResult({ misses: sayMisses(tokens, tapped), speakerWrong, mode: 'say' })), { class: 'btn primary' }),
          );
          answerArea.focus({ preventScroll: true });
        }, { class: 'btn primary' }),
      );
    }
  }

  async function finish(c, result) {
    quiet();
    tick();
    const rec = session.answer(result);
    await ctx.saveAnswer(rec);
    undo.push(rec);
    await saveSprint();
    const text = describeResult(result, c.item.tokens, c.item.speaker);
    announce(text);
    feedback(c, result, text);
  }

  function feedback(c, result, text) {
    const misses = new Set(result.misses);
    const block = h(
      'p',
      { class: `result ${result.pass ? 'perfect' : 'misses'}` },
      h('span', { class: 'icon', 'aria-hidden': 'true' }, result.pass ? '✓' : '✕'),
      h('span', {}, text),
    );
    frame(
      { ...c, message: null },
      [cueBlock(c.cue), h('p', { class: 'speaker' }, c.item.speaker), h('p', { class: 'line' }, tokenView(c.item.tokens, c.item.tokens.length, misses)), block],
      [button('Next', next, { class: 'btn primary' })],
    );
    ctx.root.querySelector('footer .btn').focus({ preventScroll: true });
    if (result.pass && ctx.settings.autoAdvance) autoTimer = setTimeout(next, AUTO_ADVANCE_MS);
  }

  async function doUndo() {
    const rec = undo.pop();
    if (!rec) return;
    quiet();
    await ctx.undoAnswer(rec);
    const c = session.restore(rec.snapshot);
    await saveSprint();
    announce('Last answer undone');
    showCard(c);
  }

  function next() {
    quiet();
    tick();
    if (timeUp() && session.boundary) return timeIsUp();
    const c = session.advance();
    if (!c) return planDone();
    saveSprint();
    showCard(c);
  }

  async function stop() {
    quiet();
    tick();
    await saveSprint();
    ctx.go('today');
  }

  function plain(title, body, footer) {
    quiet();
    clear(ctx.root).append(screen({ title, back: stop, backLabel: 'Today', body, footer }));
    focusHeading(ctx.root);
  }

  const done = () => minus(session.stats, startStats);

  function timeIsUp() {
    finished = true;
    saveSprint();
    const st = done();
    if (short) {
      return plain('Keep going?', [h('p', { class: 'lead' }, statsLine(st)), h('p', {}, 'That was 2 minutes. Starting is the hard part, and it is done.')], [
        button('Start a sprint', () => ctx.go('sprint'), { class: 'btn primary' }),
        button('Stop for now', () => ctx.go('today')),
      ]);
    }
    const mins = ctx.settings.breakMinutes;
    const fill = h('div', { class: 'timebar-fill', style: { width: '0%' } });
    const bar = h('div', { class: 'timebar', role: 'img', 'aria-label': `Break: ${plural(mins, 'minute')}` }, fill);
    const status = h('p', {}, `${plural(mins, 'minute')}. Stand up, drink some water, look into the distance.`);
    const began = Date.now();
    breakTimer = setInterval(() => {
      const share = Math.min(1, (Date.now() - began) / (mins * 60000));
      fill.style.width = `${share * 100}%`;
      if (share >= 1) {
        clearInterval(breakTimer);
        status.textContent = 'Break over. Ready when you are.';
      }
    }, 10000);
    plain('Sprint done', [h('p', { class: 'lead' }, statsLine(st)), h('h2', {}, 'Break'), bar, status], [
      button('Another sprint', () => ctx.go('sprint'), { class: 'btn primary' }),
      button('Stop for now', () => ctx.go('today')),
    ]);
  }

  function planDone() {
    const st = done();
    const plan = ctx.plan();
    const nextCheck = plan.nextAt ? h('p', {}, `The next check is ready ${untilText(plan.nextAt, Date.now(), plan.day)}.`) : null;
    const said = st.answered ? h('p', {}, statsLine(st)) : null;
    if (custom) {
      return plain('Run done', [h('p', { class: 'lead' }, `That was a run of ${heading(custom.scene)}.`), said], [
        button('Back to the scene', () => ctx.go('reader', { scene: custom.scene }), { class: 'btn primary' }),
        button('Today', () => ctx.go('today')),
      ]);
    }
    if (scope === 'tests') {
      return plain('Checks done', [h('p', { class: 'lead' }, 'Everything ready to check is done.'), nextCheck, said], [
        button('Start a sprint', () => ctx.go('sprint'), { class: 'btn primary' }),
        button('Stop for now', () => ctx.go('today')),
      ]);
    }
    const keepGoing = (what) => {
      const c = session.keepGoing(what);
      if (!c) return planDone();
      saveSprint();
      showCard(c);
    };
    const footer = [
      plan.ahead.length ? button('Head start on tomorrow', () => keepGoing('new'), { class: 'btn primary' }) : null,
      plan.extraRuns.length ? button('An extra run', () => keepGoing('runs'), { class: plan.ahead.length ? 'btn' : 'btn primary' }) : null,
      button('Stop for now', () => ctx.go('today')),
    ].filter(Boolean);
    plain("Today's plan is done", [h('p', { class: 'lead' }, 'Everything ready for now is done.'), nextCheck, said, h('p', {}, 'Keep going?')], footer);
  }

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      tick();
      saveSprint();
    } else last = Date.now();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const first = extra ? session.keepGoing(extra) : session.advance();
  if (first) showCard(first);
  else planDone();

  return () => {
    quiet();
    clearInterval(breakTimer);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
