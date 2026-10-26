// The sprint: which card comes next, and what an answer does.
// Cards: 'test' (cue, then Try it or Teach me), 'front' (the full line, to read), 'help' (the first
// letters: said aloud, revealed, any word missed tapped), 'floor' (from the cue alone, answered and checked).
// Every line the sprint shows needs one go right from the cue alone before the sprint is over; only that
// counts as right. Its first go is with the first letters when his forgetting curve says he may not
// manage without (below 95% for a newer line, below 80% once it is secure), when it was missed last time
// or has never been right without them. A miss shows the right line and moves on: the line comes back
// after at least three other answers, with the first letters, then once more without them.
// New lines come in rounds: teach a beat's lines (each read, then said from the first letters), then run
// the beats resting from the round before and the new beat. Between rounds come the lines still owed a
// go, then tests of what is already learned, up to six at a time and the most at risk first, so older
// lines are checked in between new ones. When nothing new is left, it is tests.
// At time up nothing new comes: the sprint carries on until every line it has shown is right without help.
// The session never saves anything itself: answer() returns the event and new state for the app to
// save, and advance() then picks the next card using the app's up to date states and plan.
import { applyHelp, applyResult, isSecure, needsTeaching } from './state.js';
import { recallNow } from './memory.js';
import { speakerChoices } from './items.js';
import { beatStage, testsOf, REVIEW_BURST, RUN_MIN } from './plan.js';
import { dayKey } from './dates.js';

export const TEACH_FIRST_MESSAGE = "This stretch is new to you, so I'll teach it first.";
export const AHEAD_MESSAGE = "Today's plan is done. This is a head start on tomorrow.";
export const EXTRA_RUN_MESSAGE = "Today's plan is done. This is an extra run.";
export const AGAIN_MESSAGE = 'Lines come back later in the sprint until they are right without help.';
export const CLOSING_MESSAGE = "Time's up. Just the lines still to finish, then you're done.";

export const GAP = 3; // other answers before a line comes back
// First letters first when the chance of recall now is below this (a newer line: not yet right on three
// separate days since it was learned).
export const HELP_BELOW = { newer: 0.95, secure: 0.8 };
const VERSION = 2; // of the saved sprint: one saved by the first version is not carried on

const FRONT_PROMPTS = [
  'Say it aloud, meaning it.',
  'Stand up and say it to someone.',
  'Give it a gesture that fits.',
  'What does this person want here?',
];

const LABELS = { due: 'Check', new: 'New', beat: 'Beat run', run: 'Run' };
// The card for each go a line can need: read it (then the first letters), the first letters, or the cue alone.
const STEP = { read: 'front', help: 'help', clean: 'floor', done: 'floor' };

// What one sprint keeps: the round under way, the beats resting from the last one, every line it has
// shown, how many goes so far (gaps are counted in these), and whether time is up.
const sprintState = () => ({ round: null, rest: [], lines: {}, goes: 0, tests: 0, closing: false, task: null, planDone: false });

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
    if (s.lastResult !== 'pass' || s.stability == null) return 'help';
    const { now: at, k } = plan();
    return recallNow(s, at, k) < HELP_BELOW[isSecure(s) ? 'secure' : 'newer'] ? 'help' : 'clean';
  }

  // The go a line needs after a miss: the first letters, or reading it first if it has never been right.
  function missNeed(prev) {
    const mode = helpMode();
    if (mode === 'none') return 'clean';
    return mode === 'read' || needsTeaching(prev) ? 'read' : 'help';
  }

  // What this sprint knows about a line it has shown: the go it needs next, when it last had one (in
  // goes), and whether it was missed, or right with the first letters, earlier in the sprint.
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

  const runTask = (beatId) => ({ kind: 'seq', queue: 'beat', beatId, ids: [...beatById.get(beatId).itemIds], pos: 0 });

  // A round: teach one beat, then run the beats resting from the round before, then the new one. A beat
  // started before this sprint and not yet run in it comes first, in a round of its own.
  function startRound(beats) {
    const rest = S.rest.filter(live);
    const started = beats.find((id) => live(id) && !rest.includes(id) && !toTeach(id));
    const teach = started ? null : beats.find((id) => live(id) && toTeach(id)) || null;
    const runs = [...rest];
    const own = started || teach;
    if (own && !runs.includes(own)) runs.push(own);
    S.round = { teach, runs, ran: [] };
    S.rest = [];
    const t = roundTask();
    if (!t) S.round = null;
    return t;
  }

  function roundTask() {
    const r = S.round;
    if (r.teach && live(r.teach) && toTeach(r.teach)) return teachTask(r.teach);
    const id = r.runs.find((b) => !r.ran.includes(b) && live(b));
    if (!id) return null;
    r.ran.push(id);
    return runTask(id);
  }

  // The round is over: its beats not yet learned rest until the next one.
  function endRound() {
    S.rest = S.round.runs.filter(live);
    S.round = null;
  }

  const single = (id) => ({ kind: 'item', queue: getState(id).status === 'review' ? 'due' : 'beat', id, again: true });

  // A line still owed a go, with at least `gap` other answers since its last: the longest waiting first.
  // Four or more learned lines in a row owed a go come back as a run, each far enough from its last go
  // by its turn. A line of a beat still to be run waits for that run, unless time is up.
  function owedTask(gap) {
    const pending = new Set(S.closing ? [] : [...S.rest, ...(S.round ? S.round.runs : [])].filter(live));
    const owed = Object.keys(S.lines)
      .filter((id) => owing(id) && !pending.has(byId.get(id).beat) && S.goes - S.lines[id].last >= gap)
      .sort((a, b) => S.lines[a].last - S.lines[b].last);
    if (!owed.length) return null;
    const ids = [];
    for (let it = byId.get(owed[0]); it; ) {
      const l = S.lines[it.id];
      if (!l || !owing(it.id) || getState(it.id).status !== 'review' || S.goes + ids.length - l.last < gap) break;
      ids.push(it.id);
      const next = model.items[it.index + 1];
      it = next && next.scene === it.scene ? next : null;
    }
    if (ids.length >= RUN_MIN) return { kind: 'seq', queue: 'run', scene: byId.get(ids[0]).scene, ids, pos: 0, again: true };
    return single(owed[0]);
  }

  // Nothing else is left: lines still owed come back after one other answer, with a line already right
  // in this sprint in between if need be (at time up, failing that, the next test), and failing
  // everything straight away.
  function finishOwed(p) {
    const soon = owedTask(1);
    if (soon) return soon;
    const now = owedTask(0);
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
    const test = testsOf({ model, index, getState, ready, phase: p.phase, today: p.day })[0];
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
    const beats = (S.scope !== 'all' ? [] : S.extra === 'new' ? [...p.newBeats, ...p.ahead] : p.newBeats).filter((id) => beatById.has(id));
    let t = S.round ? roundTask() : null;
    if (!t && S.round) endRound();
    if (!t && S.tests < REVIEW_BURST) t = owedTask(GAP) || planTest(p);
    if (!t && beats.length) t = startRound(beats);
    if (S.round) {
      if (!p.newBeats.includes(t.beatId) && !S.aheadSaid) {
        S.message = AHEAD_MESSAGE;
        S.aheadSaid = true;
      }
      S.tests = 0;
      return t;
    }
    t ||= owedTask(GAP) || planTest(p) || extraTask(p) || finishOwed(p);
    if (!t) S.planDone = true;
    return t;
  }

  function cardFor(t) {
    const item = byId.get(currentId(t));
    const step = currentStep(t);
    const c = { key: ++S.seq, step, queue: t.queue, item, cue: item.cue, label: t.again && t.kind === 'item' ? 'Again' : LABELS[t.queue] };
    if (t.kind === 'seq' && t.queue === 'run') c.label = `Run: ${model.scenes[item.scene].heading}`;
    if (t.kind === 'seq') c.progress = { pos: t.pos + 1, total: t.ids.length };
    if (step === 'front') c.prompt = FRONT_PROMPTS[S.frontTurn++ % FRONT_PROMPTS.length];
    if (step === 'floor') {
      const choices = settings.askSpeaker && item.askSpeaker ? speakerChoices(model, item, 6, byId) : [];
      c.askSpeaker = choices.length > 1;
      c.choices = c.askSpeaker ? choices : [];
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

    // For test and front cards. action: 'try' | 'teach' | 'next'.
    choose(action) {
      const t = S.task;
      const step = currentStep(t);
      if (step === 'test') {
        t.pretest = action === 'try';
        t.step = action === 'try' ? 'floor' : 'front';
      } else if (step === 'front') {
        if (t.step) t.step = 'help';
        else lineOf(currentId(t)).need = 'help';
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
      const { k } = plan();
      const state =
        help && result.pass ? applyHelp(prev, { day }) : applyResult(prev, { pass: result.pass, day, time, mode: result.mode, k, pretest, relearn, primed });
      const event = { time, day, id, pass: result.pass, mode: result.mode, queue, misses: result.misses.length, speakerWrong: !!result.speakerWrong, relearn, prev };
      if (help) event.help = true;
      if (primed) event.primed = true;

      S.goes += 1;
      line.last = S.goes;
      if (result.pass) {
        if (help) line.helped = true;
        line.need = help ? 'clean' : 'done';
      } else {
        line.missed = true;
        line.need = missNeed(prev);
      }
      if (!help) {
        S.stats.answered += 1;
        if (result.pass) S.stats.perfect += 1;
      }
      if (prev.status !== 'review' && state.status === 'review') {
        S.stats.learnedItems += 1;
        S.stats.learnedWords += item.words;
      }
      if ((queue === 'due' || queue === 'run') && !t.custom && !t.again) S.tests += 1;

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

    // Time is up: nothing new from here. A run under way stops; what it showed comes back on its own.
    close() {
      if (S.closing) return;
      S.closing = true;
      S.round = null;
      S.againSaid = true;
      if (S.task && S.task.kind === 'seq') S.task.done = true;
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
