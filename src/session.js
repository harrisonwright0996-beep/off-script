// The sprint: which card comes next, and what an answer does.
// Cards: 'test' (cue, then Try it or Teach me), 'front' (full line), 'back' (first letters),
// 'floor' (recall from the cue alone, answered and checked).
// New lines come in rounds: learn a beat's lines, run the beat before it again, run the new beat.
// Between rounds come tests of what is already learned, up to six answers at a time and the most at
// risk first, so older lines are checked in between new ones. When nothing new is left, it is tests.
// The session never saves anything itself: answer() returns the event and new state for the app to
// save, and advance() then picks the next card using the app's up to date states and plan.
import { applyResult } from './state.js';
import { speakerChoices } from './items.js';
import { beatStage, REVIEW_BURST } from './plan.js';
import { dayKey } from './dates.js';

export const TEACH_FIRST_MESSAGE = "This stretch is new to you, so I'll teach it first.";
export const AHEAD_MESSAGE = "Today's plan is done. This is a head start on tomorrow.";
export const EXTRA_RUN_MESSAGE = "Today's plan is done. This is an extra run.";

const FRONT_PROMPTS = [
  'Say it aloud, meaning it.',
  'Stand up and say it to someone.',
  'Give it a gesture that fits.',
  'What does this person want here?',
];

const LABELS = { due: 'Check', new: 'New', beat: 'Beat run', run: 'Run' };

// scope: 'all' (new lines and tests) or 'tests' (Just 2 minutes: tests only).
// custom: { scene, itemIds } for "Run this scene".
export function createSession({ model, index, getPlan, getState, settings, scope = 'all', custom = null, saved = null, now = () => Date.now() }) {
  const { byId, beatById } = index;
  let S = saved
    ? structuredClone(saved)
    : {
        day: dayKey(new Date(now())),
        scope,
        custom,
        task: null,
        teachFirst: {},
        tried: {},
        rest: null,
        midRound: false, // a round of new lines is under way: no tests until its beat run
        tests: 0, // test answers since the last new card
        extra: null, // after the plan is done: 'new' or 'runs'
        message: null,
        frontTurn: 0,
        seq: 0,
        boundary: true,
        stats: { answered: 0, perfect: 0, learnedItems: 0, learnedWords: 0 },
      };
  let card = null;
  let lastPlan = null;

  const stageOf = (beatId) => beatStage(beatById.get(beatId), getState);

  function testTask(t) {
    if (t.kind === 'run') return { kind: 'seq', queue: 'run', scene: t.scene, ids: [...t.itemIds], pos: 0, relearn: null };
    return { kind: 'item', queue: 'due', id: t.id, step: 'floor', ladderMisses: 0, pretest: false };
  }

  function newTask(list) {
    const beats = list.filter((id) => beatById.has(id));
    let pick = null;
    if (S.rest) {
      if (S.rest.during && stageOf(S.rest.during) !== 'learn') S.rest = null; // time for the rested beat's next run
      else if (S.rest.during) pick = S.rest.during;
      else {
        const other = beats.find((id) => id !== S.rest.beat && stageOf(id) === 'learn');
        if (other) pick = S.rest.during = other;
        else S.rest = null;
      }
    }
    if (!pick) pick = beats.find((id) => stageOf(id) !== 'done');
    if (!pick) return null;
    const beat = beatById.get(pick);
    if (stageOf(pick) === 'learn') {
      const id = beat.itemIds.find((x) => getState(x).passes === 0);
      const fresh = getState(id).status === 'new';
      const step = fresh && !S.teachFirst[pick] ? 'test' : 'front';
      return { kind: 'item', queue: 'new', id, beatId: pick, step, ladderMisses: 0, pretest: false };
    }
    return { kind: 'seq', queue: 'beat', beatId: pick, ids: [...beat.itemIds], pos: 0, relearn: null };
  }

  function nextTask() {
    if (S.custom) {
      const ids = S.custom.itemIds.filter((id) => byId.has(id));
      if (S.custom.used || !ids.length) return null;
      S.custom.used = true;
      return { kind: 'seq', queue: 'run', scene: S.custom.scene, ids, pos: 0, relearn: null, custom: true };
    }
    const plan = (lastPlan = getPlan());
    const test = plan.tests[0];
    const beats = S.scope !== 'all' ? [] : S.extra === 'new' ? [...plan.newBeats, ...plan.ahead] : plan.newBeats;
    if (test && !S.midRound && S.tests < REVIEW_BURST) return testTask(test);
    const t = beats.length ? newTask(beats) : null;
    if (t) {
      if (!plan.newBeats.includes(t.beatId) && !S.aheadSaid) {
        S.message = AHEAD_MESSAGE;
        S.aheadSaid = true;
      }
      S.tests = 0;
      S.midRound = true;
      return t;
    }
    S.midRound = false;
    if (test) return testTask(test);
    // Today's plan is done. Carry on only when asked: a head start on new lines, or extra runs.
    if (S.extra && plan.extraRuns.length) {
      if (!S.extraSaid) S.message = EXTRA_RUN_MESSAGE;
      S.extraSaid = true;
      return testTask(plan.extraRuns[0]);
    }
    S.planDone = true;
    return null;
  }

  function currentId(t) {
    return t.kind === 'item' ? t.id : t.ids[t.pos];
  }

  // The part of a task that climbs the ladder: the item task itself, or a run's relearning.
  const ladderOf = (t) => (t.kind === 'item' ? t : t.relearn);

  function currentStep(t) {
    const l = ladderOf(t);
    return l ? l.step : 'floor';
  }

  function cardFor(t) {
    const item = byId.get(currentId(t));
    const step = currentStep(t);
    const c = { key: ++S.seq, step, queue: t.queue, item, cue: item.cue, label: LABELS[t.queue] };
    if (t.queue === 'run') c.label = `Run: ${model.scenes[item.scene].heading}`;
    if (t.kind === 'seq') c.progress = { pos: t.pos + 1, total: t.ids.length };
    if (step === 'front') c.prompt = FRONT_PROMPTS[S.frontTurn++ % FRONT_PROMPTS.length];
    if (step === 'floor') {
      const choices = settings.askSpeaker && item.askSpeaker ? speakerChoices(model, item, 6, byId) : [];
      c.askSpeaker = choices.length > 1;
      c.choices = c.askSpeaker ? choices : [];
    }
    if (S.message) {
      c.message = S.message;
      S.message = null;
    }
    return c;
  }

  // Moves a ladder on after a miss: Back then Floor, and after three misses Front again.
  function ladderMiss(l) {
    l.ladderMisses += 1;
    if (l.ladderMisses >= 3) {
      l.ladderMisses = 0;
      l.step = 'front';
    } else l.step = 'back';
  }

  const api = {
    get card() {
      return card;
    },
    get boundary() {
      return S.boundary;
    },
    get stats() {
      return S.stats;
    },
    // True once everything in today's plan, for now, has been done in this sprint.
    get planDone() {
      return !!S.planDone;
    },
    get state() {
      return S;
    },

    // Picks the next card. Returns null when the plan has nothing left for this sprint.
    advance() {
      const t = S.task;
      if (!t || t.done) {
        if (t && t.queue === 'beat' && stageOf(t.beatId) === 'run') {
          S.rest = { beat: t.beatId, during: null };
          S.midRound = false; // the round ends with the new beat's first run
        }
        S.task = nextTask();
      }
      card = S.task ? cardFor(S.task) : null;
      return card;
    },

    // For test, front and back cards. action: 'try' | 'teach' | 'next'.
    choose(action) {
      const t = S.task;
      const l = ladderOf(t);
      if (l.step === 'test') {
        l.pretest = action === 'try';
        l.step = action === 'try' ? 'floor' : 'front';
      } else if (l.step === 'front') l.step = 'back';
      else if (l.step === 'back') {
        l.step = 'floor';
        l.studied = true; // the next answer comes straight after studying it
      }
      card = cardFor(t);
      return card;
    },

    // For floor cards. result: { pass, misses: [token indices], speakerWrong, mode }.
    answer(result) {
      const snapshot = structuredClone(S);
      const t = S.task;
      const l = ladderOf(t);
      const item = byId.get(currentId(t));
      const time = now();
      const day = dayKey(new Date(time));
      const prev = getState(item.id);
      const queue = t.queue;
      const relearn = !!(l && l.studied);
      const pretest = !!(t.kind === 'item' && t.pretest);
      const { k } = lastPlan || getPlan();
      const state = applyResult(prev, { pass: result.pass, day, time, mode: result.mode, k, pretest, relearn });
      const event = { time, day, id: item.id, pass: result.pass, mode: result.mode, queue, misses: result.misses.length, speakerWrong: !!result.speakerWrong, relearn, prev };

      S.stats.answered += 1;
      if (result.pass) S.stats.perfect += 1;
      if (prev.status !== 'review' && state.status === 'review') {
        S.stats.learnedItems += 1;
        S.stats.learnedWords += item.words;
      }
      if ((queue === 'due' || queue === 'run') && !t.custom) S.tests += 1;

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
        t.studied = false;
        if (result.pass) t.done = true;
        else if (t.pretest) t.step = 'front';
        else ladderMiss(t);
        t.pretest = false;
        S.boundary = !!t.done;
      } else {
        if (t.relearn) {
          t.relearn.studied = false;
          if (result.pass) {
            t.relearn = null;
            t.pos += 1;
          } else ladderMiss(t.relearn);
        } else if (result.pass || t.queue === 'run') t.pos += 1; // runs keep flowing; a miss comes back as a check
        else t.relearn = { step: 'back', ladderMisses: 1 };
        if (t.pos >= t.ids.length) t.done = true;
        S.boundary = !t.relearn;
      }
      card = null;
      return { event, state, snapshot };
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
