// What the app remembers about each item, and how one result changes it.
// status: 'new' (never practised), 'learning' (practised, fewer than 2 passes in all),
// 'review' (reached 2 passes: successive relearning's first criterion, counting only recalls from
// the cue alone; a go with the first letters is the practice before them).
// Its memory: stability in hours (memory.js), lapses (misses since it was first recalled) and when
// it was last tested. Nothing here says when to test it next: the plan works that out from the
// forgetting curve whenever the app is open.
import { FIRST, HELPED_GROWTH, HOUR, afterMiss, growth, retrievability } from './memory.js';

export const CRITERION = 2;

export function newState(id) {
  return {
    id,
    status: 'new',
    firstDay: null,
    learnedDay: null,
    passes: 0,
    misses: 0,
    helped: 0, // goes with the first letters that were right
    lapses: 0,
    stability: null,
    passDays: [],
    missDays: [],
    lastResult: null,
    lastDay: null,
    lastTime: 0,
    lastMode: null,
  };
}

const addDay = (days, day) => (days.includes(day) ? days : [...days, day]);

// result: { pass, day, time, mode, k, pretest, relearn, primed, slow }. Returns a new state; the old
// one is untouched (undo keeps it). k: his personal factor. pretest: recalled before being taught.
// relearn: a go after missing the line earlier in the same sprint, which says little about memory, so
// it does not grow it. primed: from the cue alone just after a go with the first letters, and slow:
// typed right but much slower than usual; either grows memory by half as much.
export function applyResult(state, { pass, day, time, mode, k = 1, pretest = false, relearn = false, primed = false, slow = false }) {
  const s = { ...state };
  if (s.status === 'new') {
    s.status = 'learning';
    s.firstDay = day;
  }
  if (pass) {
    s.passes += 1;
    s.passDays = addDay(s.passDays, day);
  } else {
    s.misses += 1;
    s.missDays = addDay(s.missDays, day);
  }

  if (state.stability == null) {
    if (pass) s.stability = pretest ? FIRST.known : FIRST.studied;
  } else if (!pass) {
    s.lapses = (state.lapses || 0) + 1;
    s.stability = afterMiss(state.stability);
  } else if (!relearn) {
    const r = retrievability((time - state.lastTime) / HOUR, k * state.stability);
    const g = growth(state.stability, r, state.lapses || 0);
    s.stability = state.stability * (primed || slow ? 1 + (g - 1) * HELPED_GROWTH : g);
  }

  if (state.status !== 'review' && s.passes >= CRITERION) {
    s.status = 'review';
    s.learnedDay = day;
  }
  s.lastResult = pass ? 'pass' : 'miss';
  s.lastDay = day;
  s.lastTime = time;
  s.lastMode = mode;
  return s;
}

// A go with the first letters right: it says little about memory, so it changes nothing but marks a
// new line as started. (One missed is a miss like any other: applyResult.)
export function applyHelp(state, { day }) {
  const s = { ...state, helped: (state.helped || 0) + 1 };
  if (s.status === 'new') {
    s.status = 'learning';
    s.firstDay = day;
  }
  return s;
}

// Never yet right, with or without the first letters: still to be taught.
export const needsTeaching = (s) => s.passes === 0 && !s.helped;

export const isWordPerfect = (s) => s.status === 'review' && s.lastResult === 'pass';
export const isMissed = (s) => s.status === 'review' && s.lastResult === 'miss';

// Passed on 3 or more separate days after the day it was learned, and passed last time.
export const isSecure = (s) => isWordPerfect(s) && s.passDays.filter((d) => d > s.learnedDay).length >= 3;

// For the map: 'new', 'learning', 'perfect' or 'missed'.
export function category(s) {
  if (s.status === 'new') return 'new';
  if (s.status === 'learning') return 'learning';
  return s.lastResult === 'miss' ? 'missed' : 'perfect';
}

export const passedOn = (s, day) => s.passDays.includes(day);
