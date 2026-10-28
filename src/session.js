// The sprint: which card comes next, and what an answer does.
// Cards: 'test' (cue, then Try it or Teach me), 'front' (the full line, to read), 'help' (the first
// letters: said aloud, revealed, any word missed tapped), 'floor' (from the cue alone, answered and checked).
// Every line the sprint shows needs one go right from the cue alone before the sprint is over; only that
// counts as right. Its first go is with the first letters while the line is new to him (right from the
// cue alone fewer than three times), when it was missed last time, or when his forgetting curve says he
// may not manage without (a chance of recall now below 80%). A new line has the first letters before it
// is first asked without them: taught, it is read with the rest of its beat and said from the first
// letters a few cards later, so there is a gap between reading it and saying it (a go straight after
// reading is hardly a recall); right at its first try, its next go is with the first letters. A miss
// shows the right line and moves on: the line comes back after at least three other answers, with the
// first letters, then without them.
// New lines come two beats at a time. A beat's lines are read in order, one by one (each tried from its
// cue first, or read); then each line comes back on its own and out of order, with at least three
// other answers in between, until it is learned: right from its cue alone twice. Out of order, each
// line is found from its cue, not from the line before. The next beat is read once one of the two is
// learned and every line read has had a go. After every three goes on lines coming back there is a
// check of an older line, the most at risk first, so what is learned is kept up in between; when
// nothing new is left, it is checks, each line on its own and out of order too (in the final days,
// whole scenes from the top).
// On a line of 8 words or more the first letters thin out as it gets stronger: every one, then the
// start of each phrase, then the first word and the words missed before (lettersOf).
// At time up nothing new comes: the sprint carries on until every line it has shown is right without help.
// The session never saves anything itself: answer() returns the event and new state for the app to
// save, and advance() then picks the next card using the app's up to date states and plan.
import { applyHelp, applyResult, needsTeaching } from './state.js';
import { SLOW, recallNow } from './memory.js';
import { cueOf, fnv1a, speakerChoices } from './items.js';
import { beatStage, testsOf, typedPerWord } from './plan.js';
import { dayKey } from './dates.js';

export const TEACH_FIRST_MESSAGE = "This stretch is new to you, so I'll teach it first.";
export const AHEAD_MESSAGE = "Today's plan is done. This is a head start on tomorrow.";
export const EXTRA_RUN_MESSAGE = "Today's plan is done. This is an extra run.";
export const AGAIN_MESSAGE = 'Lines come back later in the sprint until they are right without help.';
export const CLOSING_MESSAGE = "Time's up. Just the lines still to finish, then you're done.";
export const LETTERS_MESSAGE = 'As a line gets stronger, it shows fewer first letters. Say every word, the blanks too.';
export const SHUFFLE_MESSAGE = 'Each new line comes back on its own and out of order, until it is right from its cue twice.';

export const GAP = 3; // other answers before a line comes back
export const POOL = 2; // beats being learned at a time
export const CHECK_EVERY = 3; // goes on lines coming back, then a check of an older line
const SHUFFLE = 3; // how far the order of lines coming back is shaken up, in answers
// First letters first when the chance of recall now is below this. A line falls due at 90%, so a check
// on time is from the cue alone: the go that builds memory, and the one the curve learns from.
export const HELP_BELOW = 0.8;
// Right from the cue alone fewer times than this: the first letters first, whatever the curve says.
export const EARLY = 3;
const VERSION = 2; // of the saved sprint: one saved by the first version is not carried on

// Left to Off Script, whether a line already started has its first go with the first letters.
export const helpFirst = (s, now, k = 1) => s.passes < EARLY || s.lastResult !== 'pass' || recallNow(s, now, k) < HELP_BELOW;

// How many first letters a first letters go shows, when Off Script chooses the help: on a line of
// LONG words or more, every one while it has never been right from the cue alone, or after a miss
// (last time, or earlier in this sprint); then only at the start of each phrase once it is right
// once; then only the first word's and those of the words missed before once it is right twice. A
// line right more often has them only when it is slipping at a check: at the start of each phrase.
// The least help that still works: on a long line the jump from every first letter to none is too
// big, and help taken away step by step gave the best recall (Finley and others 2011).
export const LONG = 8;
export function lettersOf(s, words, missedHere = false) {
  if (words < LONG || missedHere || s.passes === 0 || s.lastResult !== 'pass') return 'all';
  if (s.passes === 1) return 'phrases';
  if (s.passes === 2) return 'missed';
  return 'phrases';
}

const FRONT_PROMPTS = [
  'Say it aloud, meaning it.',
  'Stand up and say it to someone.',
  'Give it a gesture that fits.',
  'What does this person want here?',
];

const LABELS = { due: 'Check', new: 'New', beat: 'Learning', run: 'Run' };
// The card for each go a line can need: read it (then the first letters), the first letters, or the cue alone.
const STEP = { read: 'front', help: 'help', clean: 'floor', done: 'floor' };

// What a saved chosen practice still has to go: lines not yet reached, the rest of the one under way,
// and lines still owed a go.
export function linesLeft(saved) {
  const c = saved && saved.custom;
  if (!c) return 0;
  const left = new Set(c.itemIds.slice(c.pos || 0));
  const t = saved.task;
  if (t && !t.done) for (const id of t.kind === 'seq' ? t.ids.slice(t.pos) : [t.id]) left.add(id);
  for (const [id, line] of Object.entries(saved.lines)) if (line.need !== 'done') left.add(id);
  return left.size;
}

// What one sprint keeps: the beats being learned, the one being read, goes on lines coming back since
// the last check, the line answered last, every line it has shown, how many goes so far (gaps are
// counted in these), and whether time is up.
const sprintState = () => ({ pool: [], teach: null, streak: 0, lastId: null, lines: {}, goes: 0, closing: false, task: null, planDone: false });

// scope: 'all' (new lines and tests) or 'tests' (Just 2 minutes: tests only).
// custom: { scene, itemIds, help } for "Run this scene" and chosen practice: the lines in order, run
// where they follow on in a scene. help: 'auto' (as above), 'none' (always from the cue alone, misses
// too), 'letters' (the first letters first for every line), 'read' (read it, the first letters, then without).
export function createSession({ model, index, getPlan, getState, settings, scope = 'all', custom = null, saved = null, now = () => Date.now() }) {
  const { byId, beatById } = index;
  let S =
    saved && saved.v === VERSION
      ? structuredClone(saved)
      : {
          v: VERSION,
          day: dayKey(new Date(now())),
          scope,
          custom,
          teachFirst: {},
          tried: {},
          extra: null, // after the plan is done: 'new' or 'runs'
          message: null,
          frontTurn: 0,
          seq: 0,
          stats: { answered: 0, perfect: 0, learnedItems: 0, learnedWords: 0 },
          ...sprintState(),
        };
  S.pool ||= []; // a sprint saved by Release 12 or before
  S.streak ||= 0;
  let card = null;
  let lastPlan = null;

  const plan = () => lastPlan || (lastPlan = getPlan());
  const helpMode = () => (S.custom && S.custom.help) || 'auto';
  const stageOf = (beatId) => beatStage(beatById.get(beatId), getState);
  const live = (beatId) => beatById.has(beatId) && stageOf(beatId) !== 'done';

  // The first go this sprint gives a line.
  function firstNeed(id) {
    const s = getState(id);
    const mode = helpMode();
    if (mode === 'none') return 'clean';
    if (mode === 'read') return 'read';
    if (mode === 'letters') return 'help';
    if (s.status === 'new') return 'clean'; // never practised: try it from the cue first
    const { now: at, k } = plan();
    return helpFirst(s, at, k) ? 'help' : 'clean';
  }

  // The go a line needs after a miss: the first letters, or reading it first if it has never been right.
  function missNeed(prev) {
    const mode = helpMode();
    if (mode === 'none') return 'clean';
    return mode === 'read' || needsTeaching(prev) ? 'read' : 'help';
  }

  // What this sprint knows about a line it has shown: the go it needs next, when it last had one (in
  // cards), whether it was missed, right with the first letters, or right from the cue alone earlier
  // in the sprint, whether it was taught (read with its beat) in it, whether it is still waiting for
  // its first go since being read (justRead), and when the teaching it was tried or read in began
  // (from), until its next go.
  function lineOf(id) {
    return (S.lines[id] ||= { need: firstNeed(id), last: -GAP, missed: false, helped: false });
  }

  const currentId = (t) => (t.kind === 'item' ? t.id : t.ids[t.pos]);
  const currentStep = (t) => t.step || STEP[lineOf(currentId(t)).need];
  const owing = (id) => byId.has(id) && S.lines[id].need !== 'done';

  // A line of a beat still to be taught: never yet right, and not yet shown in this sprint.
  const toTeach = (beatId) => beatById.get(beatId).itemIds.find((id) => !S.lines[id] && needsTeaching(getState(id))) || null;

  function teachTask(beatId) {
    const id = toTeach(beatId);
    const step = getState(id).status === 'new' && !S.teachFirst[beatId] ? 'test' : 'front';
    return { kind: 'item', queue: 'new', id, beatId, step, pretest: false };
  }

  // A line of one of the beats being learned.
  const pooled = (id) => S.pool.includes(byId.get(id).beat);

  // A beat joins the two being learned: its lines still to be taught are read first, one by one; the
  // rest, started before and not yet learned, are owed a go straight away.
  function join(beatId) {
    S.pool.push(beatId);
    for (const id of beatById.get(beatId).itemIds) {
      const s = getState(id);
      if (s.status === 'review' || (!S.lines[id] && needsTeaching(s))) continue;
      if (S.lines[id] && !owing(id)) delete S.lines[id];
      lineOf(id);
    }
    if (toTeach(beatId)) {
      S.teach = beatId;
      S.readFrom = S.goes;
    }
  }

  // Room for the next beat: fewer than two being learned, and every line read has had a go since.
  const room = () => S.pool.length < POOL && !Object.values(S.lines).some((l) => l.justRead);

  // A line coming back on its own: a line being learned, or a line coming back Again.
  const single = (id) => {
    const review = getState(id).status === 'review';
    return { kind: 'item', queue: review ? 'due' : 'beat', id, again: review || !pooled(id) };
  };

  // A number from 0 to 1 for each line, different after every answer: it shakes up the order lines come in.
  const shake = (id) => parseInt(fnv1a(`${S.goes}:${id}`), 36) / 2 ** 32;
  // The line straight after the one just answered: asked next, it would be a run in order.
  const follows = (id) => {
    const a = S.lastId && byId.get(S.lastId);
    const b = byId.get(id);
    return !!a && !!b && a.scene === b.scene && b.index === a.index + 1;
  };

  // A line still owed a go, with at least `gap` other cards since its last: the longest waiting first,
  // give or take a few cards, so lines come back out of order; not the line after the one just
  // answered, unless `any`. Lines taught together (tried or read) wait as one until their next go,
  // from the start of their teaching, so those goes are in any order.
  function owedTask(gap, any = false) {
    const owed = Object.keys(S.lines).filter((id) => owing(id) && S.goes - S.lines[id].last >= gap && (any || !follows(id)));
    if (!owed.length) return null;
    const wait = (id) => S.goes - (S.lines[id].from ?? S.lines[id].last) + SHUFFLE * shake(id);
    return single(owed.reduce((a, b) => (wait(b) > wait(a) ? b : a)));
  }

  // Nothing else is left: lines still owed come back after one other answer, with a line already right
  // in this sprint in between if need be (at time up, failing that, the next test), and failing
  // everything straight away.
  function finishOwed(p) {
    const soon = owedTask(1) || owedTask(1, true);
    if (soon) return soon;
    const now = owedTask(0, true);
    if (!now) return null;
    const done = Object.keys(S.lines)
      .filter((id) => byId.has(id) && S.lines[id].need === 'done')
      .sort((a, b) => S.lines[a].last - S.lines[b].last);
    if (done.length) return single(done[0]);
    return (S.closing && planTest(p)) || now;
  }

  // Lines already right in this sprint, coming up again: the go each needs is worked out afresh.
  function fresh(ids) {
    for (const id of ids) if (S.lines[id] && !owing(id)) delete S.lines[id];
    return ids;
  }

  // The test most at risk now. Lines still owed a go are left out (they come back on their own); a line
  // already right in this sprint comes back when the curve says it is due again.
  function planTest(p) {
    const ready = new Map([...p.ready].filter(([id]) => !S.lines[id] || !owing(id)));
    const tests = testsOf({ model, index, getState, ready, phase: p.phase, today: p.day, shuffle: true });
    const test = tests.find((x) => x.kind === 'run' || !follows(x.id)) || tests[0];
    if (!test) return null;
    if (test.kind === 'run') return { kind: 'seq', queue: 'run', scene: test.scene, ids: fresh([...test.itemIds]), pos: 0 };
    fresh([test.id]);
    return { kind: 'item', queue: 'due', id: test.id };
  }

  // Today's plan is done. Carry on only when asked: extra runs, the least secure scene first.
  function extraTask(p) {
    if (!S.extra || !p.extraRuns.length) return null;
    if (!S.extraSaid) S.message = EXTRA_RUN_MESSAGE;
    S.extraSaid = true;
    const r = p.extraRuns[0];
    return { kind: 'seq', queue: 'run', scene: r.scene, ids: fresh([...r.itemIds]), pos: 0 };
  }

  // Chosen practice: its lines in order, a run wherever they follow on in a scene, what is owed in between.
  function customTask(p) {
    const c = S.custom;
    const ids = c.itemIds.filter((id) => byId.has(id));
    const owed = owedTask(GAP);
    if (owed) return owed;
    let pos = c.pos || 0;
    if (S.closing || pos >= ids.length) return finishOwed(p);
    const run = [ids[pos++]];
    for (; pos < ids.length; pos++) {
      const a = byId.get(run[run.length - 1]);
      const b = byId.get(ids[pos]);
      if (b.scene !== a.scene || b.index !== a.index + 1) break;
      run.push(b.id);
    }
    c.pos = pos;
    if (run.length === 1) return { kind: 'item', queue: 'due', id: run[0], custom: true };
    return { kind: 'seq', queue: 'run', scene: byId.get(run[0]).scene, ids: run, pos: 0, custom: true };
  }

  function nextTask() {
    const p = (lastPlan = getPlan());
    if (S.custom) return customTask(p);
    if (S.closing) return owedTask(GAP) || finishOwed(p);
    S.pool = S.pool.filter(live);
    if (S.teach && !(live(S.teach) && toTeach(S.teach))) S.teach = null;
    if (!S.teach && S.scope === 'all' && room()) {
      const beats = (S.extra === 'new' ? [...p.newBeats, ...p.ahead] : p.newBeats).filter((id) => beatById.has(id));
      const next = beats.find((id) => live(id) && !S.pool.includes(id));
      if (next) {
        join(next);
        if (!p.newBeats.includes(next) && !S.aheadSaid) {
          S.message = AHEAD_MESSAGE;
          S.aheadSaid = true;
        }
      }
    }
    if (S.teach) return teachTask(S.teach);
    // After every few goes on lines coming back, a check; otherwise the line owed a go that has waited
    // longest, then a check, then (once today's plan is done, if asked) an extra run.
    let test;
    const check = () => (test === undefined ? (test = planTest(p)) : test);
    const owed = S.streak >= CHECK_EVERY && check() ? null : owedTask(GAP);
    const t = owed || check() || extraTask(p) || finishOwed(p);
    S.streak = owed ? S.streak + 1 : 0;
    if (!t) S.planDone = true;
    return t;
  }

  function cardFor(t) {
    const item = byId.get(currentId(t));
    const step = currentStep(t);
    const c = { key: ++S.seq, step, queue: t.queue, item, cue: cueOf(index, item), label: t.again && t.kind === 'item' ? 'Again' : LABELS[t.queue] };
    if (t.kind === 'seq' && t.queue === 'run') c.label = `Run: ${model.scenes[item.scene].heading}`;
    if (t.kind === 'seq') c.progress = { pos: t.pos + 1, total: t.ids.length };
    if (step === 'front') c.prompt = FRONT_PROMPTS[S.frontTurn++ % FRONT_PROMPTS.length];
    if (step === 'help') {
      c.letters = helpMode() === 'auto' ? lettersOf(getState(item.id), item.words, lineOf(item.id).missed) : 'all';
      if (c.letters !== 'all' && !S.lettersSaid) {
        S.message ||= LETTERS_MESSAGE;
        S.lettersSaid = true;
      }
    }
    if (step === 'floor') {
      const choices = settings.askSpeaker && item.askSpeaker ? speakerChoices(model, item, 6, byId) : [];
      c.askSpeaker = choices.length > 1;
      c.choices = c.askSpeaker ? choices : [];
    }
    if (t.queue === 'beat' && t.kind === 'item' && !S.shuffleSaid) {
      S.message ||= SHUFFLE_MESSAGE;
      S.shuffleSaid = true;
    }
    if (t.again && !S.againSaid) {
      S.message ||= AGAIN_MESSAGE;
      S.againSaid = true;
    }
    if (S.message) {
      c.message = S.message;
      S.message = null;
    }
    return c;
  }

  const api = {
    get card() {
      return card;
    },
    get stats() {
      return S.stats;
    },
    // True once everything in today's plan, for now, has been done in this sprint.
    get planDone() {
      return !!S.planDone;
    },
    // True once time is up: nothing new comes, only what the sprint still owes.
    get closing() {
      return S.closing;
    },
    get state() {
      return S;
    },

    // Picks the next card. Returns null when there is nothing left for this sprint.
    advance() {
      if (!S.task || S.task.done) S.task = nextTask();
      card = S.task ? cardFor(S.task) : null;
      return card;
    },

    // For test and front cards. action: 'try' | 'teach' | 'next'. Returns the card that follows, or null
    // once a line taught is read: then advance(), as after an answer.
    choose(action) {
      const t = S.task;
      const step = currentStep(t);
      if (step === 'test') {
        t.pretest = action === 'try';
        t.step = action === 'try' ? 'floor' : 'front';
      } else if (step === 'front') {
        if (action !== 'next') return card; // only Next moves on from a line being read
        const line = lineOf(currentId(t));
        line.need = 'help';
        if (t.step) {
          // Taught: on to the next line of the beat. This one is said from the first letters once the
          // rest is read, on its own and out of order.
          line.taught = true;
          line.justRead = true;
          line.from = S.readFrom;
          line.last = S.goes += 1; // reading takes a card too: gaps are counted from it
          t.done = true;
          card = null;
          return null;
        }
      }
      card = cardFor(t);
      return card;
    },

    // For help and floor cards. result: { pass, misses: [token indices], speakerWrong, mode }.
    // Returns the event and new state to save, the snapshot for undo, what the line needs next and
    // whether it comes back later for it.
    answer(result) {
      const snapshot = structuredClone(S);
      const t = S.task;
      const id = currentId(t);
      const item = byId.get(id);
      const line = lineOf(id);
      const help = currentStep(t) === 'help';
      const time = now();
      const day = dayKey(new Date(time));
      const prev = getState(id);
      const queue = t.queue;
      const relearn = line.missed;
      const primed = !help && line.helped && !relearn;
      const pretest = !help && (!!t.pretest || prev.status === 'new');
      const { k, typing } = plan();
      // Typed right from the cue alone, but more than twice as slowly a word as usual once under way.
      const perWord = typedPerWord(result, item);
      const slow = result.pass && !help && !primed && !relearn && !result.slip && typing != null && perWord != null && perWord > SLOW * typing;
      const state =
        help && result.pass ? applyHelp(prev, { day }) : applyResult(prev, { pass: result.pass, day, time, mode: result.mode, k, pretest, relearn, primed, slow });
      const event = { time, day, id, pass: result.pass, mode: result.mode, queue, misses: result.misses.length, speakerWrong: !!result.speakerWrong, relearn, prev };
      if (help) event.help = true;
      if (primed) event.primed = true;
      if (slow) event.slow = true;
      // Which words, and how quickly: for trouble words and fluency later.
      if (result.misses.length) event.missed = [...result.misses];
      if (result.ms != null) event.ms = result.ms;
      if (result.firstMs != null) event.firstMs = result.firstMs;
      if (result.slip) event.slip = true; // a wrong key he says was a slip of the finger

      S.goes += 1;
      line.last = S.goes;
      line.justRead = false;
      if (queue === 'new') line.from = S.readFrom; // tried with its beat: its next go is in any order with theirs
      else delete line.from;
      S.lastId = id;
      if (result.pass) {
        if (help) line.helped = true;
        else line.clean = true;
        // A new line has the first letters once more before it goes without: after its first go right
        // with them, or when it was right at its very first try.
        const again = helpMode() !== 'none' && (help ? prev.passes === 0 && !prev.helped && !line.taught : prev.status === 'new');
        // A line being learned is asked again from its cue alone until it is learned, unless time is up.
        const more = !help && !S.closing && pooled(id) && state.status !== 'review';
        line.need = again ? 'help' : help || more ? 'clean' : 'done';
      } else {
        line.missed = true;
        line.clean = false;
        line.need = missNeed(prev);
        line.taught = false; // read again, it has the first letters twice, as a line not yet taught does
      }
      if (!help) {
        S.stats.answered += 1;
        if (result.pass) S.stats.perfect += 1;
      }
      if (prev.status !== 'review' && state.status === 'review') {
        S.stats.learnedItems += 1;
        S.stats.learnedWords += item.words;
      }

      if (t.kind === 'item') {
        if (t.pretest) {
          // Test first: if two of the first three lines tried in a beat are missed, teach the rest first.
          const tr = (S.tried[t.beatId] ||= { n: 0, missed: 0 });
          tr.n += 1;
          if (!result.pass) tr.missed += 1;
          if (tr.n <= 3 && tr.missed >= 2 && !S.teachFirst[t.beatId]) {
            S.teachFirst[t.beatId] = true;
            S.message = TEACH_FIRST_MESSAGE;
          }
        }
        if (t.pretest && !result.pass) t.step = 'front'; // a missed try is taught: read it, then the first letters
        else t.done = true;
        t.pretest = false;
      } else {
        t.pos += 1; // runs keep flowing: a miss comes back later
        if (t.pos >= t.ids.length) t.done = true;
      }
      card = null;
      // Whether the line comes back later in the sprint (a missed try is taught there and then instead).
      const later = line.need !== 'done' && (t.kind === 'seq' || !!t.done);
      return { event, state, snapshot, need: line.need, help, later };
    },

    // Time is up: nothing new from here. A run under way stops; what it showed comes back on its own,
    // and in a chosen practice the lines it had not reached are kept for when he carries on.
    close() {
      if (S.closing) return;
      S.closing = true;
      S.teach = null;
      S.againSaid = true;
      // Only lines this sprint has shown are finished: the rest of the beats being learned wait.
      const showing = S.task && !S.task.done ? currentId(S.task) : null;
      for (const [id, line] of Object.entries(S.lines)) if (line.last < 0 && id !== showing) delete S.lines[id];
      // Right from the cue alone once in this sprint is enough at time up.
      for (const line of Object.values(S.lines)) if (line.clean && line.need === 'clean') line.need = 'done';
      if (S.task && S.task.kind === 'seq') {
        if (S.task.custom) S.custom.pos -= S.task.ids.length - S.task.pos;
        S.task.done = true;
      }
      if ((S.task && !S.task.done) || Object.keys(S.lines).some(owing)) S.message = CLOSING_MESSAGE;
    },

    // After Sprint done: the next sprint starts afresh (the day's teaching choices and totals carry on).
    finish() {
      Object.assign(S, sprintState());
      card = null;
    },

    // After "Today's plan is done": what: 'new' (a head start, with checks in between) or 'runs'.
    keepGoing(what = 'new') {
      S.extra = what;
      S.planDone = false;
      return this.advance();
    },

    // Undo: the app restores the item state and removes the event, then calls this.
    restore(snapshot) {
      S = structuredClone(snapshot);
      card = S.task ? cardFor(S.task) : null;
      return card;
    },

    // What to save so a sprint can carry on after the app closes.
    save() {
      return structuredClone(S);
    },
  };
  if (S.task && !S.task.done && byId.has(currentId(S.task))) card = cardFor(S.task);
  else S.task = null;
  return api;
}
