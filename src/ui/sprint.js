// The sprint: one card at a time from the session (session.js), answered on the keypad (Type) or by
// tapping the words missed (Say); a first letters card is always said. Every answer is saved at once,
// and so is the sprint, so closing the app loses nothing. Time is a slim bar that only moves when he
// does something; at time up nothing new comes, only the lines still to finish, then Sprint done.
import { h, clear, screen, button, announce, focusHeading, num, plural } from './dom.js';
import { createSession, linesLeft } from '../session.js';
import { createTypeCheck, sayMisses, makeResult, describeResult } from '../grade.js';
import { firstLettersLine } from '../tokens.js';
import { canSpeak, speak, stopSpeaking } from '../tts.js';
import { untilText } from '../plan.js';
import { keypad } from './keypad.js';

const SAVED = 'sprint';
export const PRACTICE = 'practice'; // a chosen practice, saved apart from the day's sprint
const IDLE_CAP = 150000; // a longer pause between taps was a break: it is not counted as sprint time
const AUTO_ADVANCE_MS = 1200;
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];

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

// After an answer that leaves a line still to finish: how it comes back.
const COMES_BACK = {
  help: 'It comes back later with the first letters, then without.',
  clean: 'It comes back later without the first letters.',
  read: 'It comes back later to read first.',
};
const comesBack = (rec) => (rec.later ? COMES_BACK[rec.need] : null);

// scope: 'all' or 'tests' (Just 2 minutes). minutes: the sprint length (settings by default).
// custom: { scene, itemIds } for Run this scene. extra: 'new' or 'runs' to keep going after the plan.
// practice: a chosen practice ({ scene, which, help, itemIds, title }), or 'resume' to carry on the
// one saved.
export async function showSprint(ctx, { scope = 'all', minutes = null, custom = null, extra = null, practice = null } = {}) {
  const today = ctx.today();
  const length = (minutes ?? ctx.settings.sprintMinutes) * 60000;
  const short = minutes != null && minutes <= 2;
  const key = practice ? PRACTICE : SAVED;
  const resumable = !!practice || (scope === 'all' && !custom);
  const fresh = !!practice && practice !== 'resume'; // a new chosen practice starts afresh
  const saved = resumable && !fresh ? await ctx.store.get(key) : null;
  const usable = !!saved && saved.day === today && saved.hash === ctx.model.hash;
  if (practice === 'resume' && !usable) return ctx.go('choose');
  ctx.refit();

  const session = createSession({
    model: ctx.model,
    index: ctx.index,
    getPlan: () => ctx.plan(),
    getState: ctx.getState,
    settings: ctx.settings,
    scope,
    custom: fresh ? practice : custom,
    saved: usable ? saved.state : null,
  });
  const chosen = practice ? session.state.custom : null; // the chosen practice under way
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
  const speakerName = (it) => (it.part > 0 ? `${it.speaker}, continuing` : it.speaker);

  const tick = () => {
    const now = Date.now();
    if (document.visibilityState === 'visible') elapsed += Math.min(now - last, IDLE_CAP);
    last = now;
  };
  const timeUp = () => elapsed >= length;

  let hiddenAt = 0; // when the app last went into the background
  // How long an answer took since `start`, or null when the app was away meanwhile or it was a break.
  const timed = (start) => {
    const ms = Date.now() - start;
    return hiddenAt >= start || ms > IDLE_CAP ? null : ms;
  };

  async function saveSprint() {
    if (!resumable) return;
    await ctx.store.set(key, { day: today, hash: ctx.model.hash, state: session.save(), elapsed: finished ? 0 : elapsed });
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

  // The cue: who speaks and what they say, or the start of a scene. A cue made longer, so that only
  // one line fits, shows the lines before it too, and which time it comes if the exchange repeats.
  function cueBlock(cue) {
    const say = (l) => (l.speaker === null ? h('p', {}, `Start of ${l.text}`) : h('p', {}, h('strong', {}, l.speaker), ': ', l.text));
    const nth = cue.nth ? h('p', { class: 'note' }, `The ${ORDINALS[cue.nth - 1] || `number ${cue.nth}`} time these lines come in the scene.`) : null;
    return h('div', { class: 'cue' }, h('p', { class: 'cue-label' }, 'Cue'), (cue.lines || [cue]).map(say), cue.notes.map((n) => h('p', { class: 'note' }, n)), nth);
  }

  const readAloud = (text) =>
    canSpeak() ? button('Read aloud', () => speak(text, { voiceURI: ctx.settings.voiceURI, rate: ctx.settings.rate })) : null;

  // The page scrolls behind the bar and the footer (the keypad, or the buttons), so a long cue and a
  // long line can push the line being answered out of sight. Scrolls down just enough to show `el`
  // above the footer, keeping its top below the bar.
  function keepInView(el) {
    if (!el || !el.isConnected) return;
    const bar = ctx.root.querySelector('.bar');
    const foot = ctx.root.querySelector('footer');
    const top = bar ? bar.getBoundingClientRect().bottom : 0;
    const bottom = foot ? foot.getBoundingClientRect().top : window.innerHeight;
    const r = el.getBoundingClientRect();
    const by = Math.min(r.bottom + 8 - bottom, r.top - 8 - top);
    if (by > 0) window.scrollBy(0, by);
  }

  // Draws a card: the bar, where it is, any message, then the card's own content and actions.
  function frame(c, content, footer, footerClass = '') {
    quiet();
    const actions = undo.length ? [button('Undo', doUndo, { class: 'btn link', aria: 'Undo last answer' })] : [];
    const body = [timeBar(), where(c), c.message ? h('p', { class: 'message', role: 'status' }, c.message) : null, ...content];
    clear(ctx.root).append(screen({ title: c.label, back: stop, backLabel: 'Stop', actions, body, footer, footerClass, className: 'sprint' }));
    window.scrollTo(0, 0); // each card starts at its cue
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
    } else if (c.step === 'help') helpCard(c);
    else floor(c);
    if (focus) focusHeading(ctx.root);
  }

  async function choose(action) {
    tick();
    const c = session.choose(action);
    await saveSprint();
    showCard(c);
  }

  // Say: reveal the line, tap any word missed or changed, then Done with the words tapped.
  function sayCheck(tokens, answerArea, footBox, prompt, done) {
    const start = Date.now();
    answerArea.append(h('p', { class: 'prompt' }, prompt));
    clear(footBox).append(
      button('Reveal', () => {
        const ms = timed(start);
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
        keepInView(answerArea);
        let sent = false; // a quick second tap is not a second answer
        clear(footBox).append(
          button('Done', () => {
            if (sent) return;
            sent = true;
            done(sayMisses(tokens, tapped), ms);
          }, { class: 'btn primary' }),
        );
        answerArea.focus({ preventScroll: true });
      }, { class: 'btn primary' }),
    );
  }

  // First letters: the speaker and the first letter of every word, said aloud, then checked as in Say.
  function helpCard(c) {
    const item = c.item;
    const answerArea = h('div', { class: 'answer-area', role: 'group', tabindex: '-1', 'aria-label': 'Your line' }, h('p', { class: 'line' }, firstLettersLine(item.tokens)));
    const footBox = h('div', { class: 'stack-foot' });
    frame(c, [cueBlock(c.cue), h('p', { class: 'speaker' }, speakerName(item)), answerArea], [footBox]);
    sayCheck(item.tokens, answerArea, footBox, 'Say it aloud from the first letters, then reveal it.', (misses, ms) => finish(c, makeResult({ misses, mode: 'say', ms })));
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

    let answerStart = 0;
    const startAnswer = () => {
      answerStart = Date.now();
      return mode === 'type' ? typeAnswer() : sayAnswer();
    };

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
      speakerArea.append(h('p', { class: 'speaker' }, speakerName(item)));
      startAnswer();
    }

    function typeAnswer() {
      const check = createTypeCheck(tokens);
      const line = h('p', { class: 'line answer' });
      // Said or mouthed, a line is remembered better than in the head alone (the production effect).
      const hint = h('p', { class: 'help' }, 'Say or mouth each word as you tap its first letter. ? shows the next word.');
      const draw = () => clear(line).append(...tokenView(tokens, check.shownUpTo, new Set(check.misses)));
      draw();
      answerArea.append(line, hint);
      let firstMs;
      const pad = keypad((key) => {
        const r = key === '?' ? check.reveal() : check.press(key);
        if (!r) return;
        if (firstMs === undefined) firstMs = timed(answerStart);
        hint.remove();
        draw();
        keepInView(line);
        announce(`${r.correct ? '' : 'Missed: '}${tokens[r.index].d}`);
        if (!r.done) return;
        // One or two wrong keys, each touching the right one, and nothing else wrong: he may say it
        // was only a slip of the finger.
        const slipped = !speakerWrong && check.misses.length <= 2 && check.misses.every((i) => check.slips.includes(i));
        finish(c, makeResult({ misses: check.misses, speakerWrong, mode: 'type', ms: timed(answerStart), firstMs }), { slipped });
      });
      removeKeys = pad.remove;
      clear(footBox).append(pad.el);
      foot.className = 'foot keyboard';
      keepInView(line);
    }

    function sayAnswer() {
      sayCheck(tokens, answerArea, footBox, 'Say it aloud, then reveal it.', (misses, ms) => finish(c, makeResult({ misses, speakerWrong, mode: 'say', ms })));
    }
  }

  async function finish(c, result, { slipped = false } = {}) {
    quiet();
    tick();
    const rec = session.answer(result);
    await ctx.saveAnswer(rec);
    undo.push(rec);
    await saveSprint();
    const text = rec.help && result.pass ? 'Right with the first letters' : result.slip ? 'Counted right: a slip of the finger' : describeResult(result, c.item.tokens, c.item.speaker);
    const note = comesBack(rec);
    announce(note ? `${text}. ${note}` : text);
    feedback(c, result, text, note, slipped && !result.pass);
  }

  // He says the wrong keys were only slips of the finger: the answer is taken back and saved as right.
  async function countRight(c, result) {
    const rec = undo.pop();
    if (!rec) return;
    quiet();
    await ctx.undoAnswer(rec);
    session.restore(rec.snapshot);
    await finish(c, makeResult({ misses: [], mode: result.mode, ms: result.ms, firstMs: result.firstMs, slip: true }));
  }

  function feedback(c, result, text, note, slipped = false) {
    const misses = new Set(result.misses);
    const block = h(
      'p',
      { class: `result ${result.pass ? 'perfect' : 'misses'}` },
      h('span', { class: 'icon', 'aria-hidden': 'true' }, result.pass ? '✓' : '✕'),
      h('span', {}, text),
    );
    frame(
      { ...c, message: null },
      [cueBlock(c.cue), h('p', { class: 'speaker' }, c.item.speaker), h('p', { class: 'line' }, tokenView(c.item.tokens, c.item.tokens.length, misses)), block, note ? h('p', { class: 'help' }, note) : null],
      [button('Next', next, { class: 'btn primary' }), slipped ? button('A slip of the finger? Count it right', () => countRight(c, result)) : null].filter(Boolean),
    );
    ctx.root.querySelector('footer .btn').focus({ preventScroll: true });
    keepInView(block);
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

  // Shows the card `pick` gives. Once time is up nothing new comes: the lines the sprint still owes,
  // then Sprint done.
  function carryOn(pick) {
    if (timeUp()) session.close();
    const c = pick();
    if (!c) return session.closing ? timeIsUp() : planDone();
    saveSprint();
    showCard(c);
  }

  function next() {
    quiet();
    tick();
    carryOn(() => session.advance());
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
    session.finish();
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
    const left = chosen ? linesLeft(session.state) : 0;
    plain('Sprint done', [h('p', { class: 'lead' }, statsLine(st)), left ? h('p', {}, `${plural(left, 'line')} of this practice still to go.`) : null, h('h2', {}, 'Break'), bar, status], [
      left
        ? button('Carry on', () => ctx.go('sprint', { practice: 'resume' }), { class: 'btn primary' })
        : button('Another sprint', () => ctx.go('sprint'), { class: 'btn primary' }),
      button('Stop for now', () => ctx.go('today')),
    ]);
  }

  function planDone() {
    const st = done();
    const plan = ctx.plan();
    const nextCheck = plan.nextAt ? h('p', {}, `The next check is ready ${untilText(plan.nextAt, Date.now(), plan.day)}.`) : null;
    const said = st.answered ? h('p', {}, statsLine(st)) : null;
    if (chosen) {
      return plain('Practice done', [h('p', { class: 'lead' }, `${chosen.title}.`), said], [
        button('Choose again', () => ctx.go('choose'), { class: 'btn primary' }),
        button('Today', () => ctx.go('today')),
      ]);
    }
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
    const keepGoing = (what) => carryOn(() => session.keepGoing(what));
    const footer = [
      plan.ahead.length ? button('Head start on tomorrow', () => keepGoing('new'), { class: 'btn primary' }) : null,
      plan.extraRuns.length ? button('An extra run', () => keepGoing('runs'), { class: plan.ahead.length ? 'btn' : 'btn primary' }) : null,
      button('Stop for now', () => ctx.go('today')),
    ].filter(Boolean);
    plain("Today's plan is done", [h('p', { class: 'lead' }, 'Everything ready for now is done.'), nextCheck, said, h('p', {}, 'Keep going?')], footer);
  }

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      tick();
      saveSprint();
    } else last = Date.now();
  };
  document.addEventListener('visibilitychange', onVisibility);

  carryOn(() => (extra ? session.keepGoing(extra) : session.advance()));

  return () => {
    quiet();
    clearInterval(breakTimer);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
