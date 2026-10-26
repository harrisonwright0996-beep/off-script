// Chosen practice: which lines a choice gives, in script order, a plain name for it, and about how
// long it takes. Where: the whole play (scene null) or one scene. Which: 'learning' (started, but not
// yet secure, or missed last time), 'learned' (everything learned so far) or 'all' (every line). How
// much help is the session's to apply (session.js).
import { isSecure } from './state.js';
import { helpFirst } from './session.js';

const KEEP = {
  learning: (s) => s.status !== 'new' && !isSecure(s),
  learned: (s) => s.status === 'review',
  all: () => true,
};
const NAMES = { learning: 'lines still being learned', learned: 'everything learned so far', all: 'every line' };

export function practiceLines({ model, getState, scene = null, which }) {
  return model.items.filter((it) => (scene === null || it.scene === scene) && KEEP[which](getState(it.id))).map((it) => it.id);
}

export const practiceTitle = ({ model, scene = null, which }) => `${scene === null ? 'The whole play' : model.scenes[scene].heading}, ${NAMES[which]}`;

// Goes a started line gets: from the cue alone, or the first letters first and later without (a
// little more when it is read first). Left to Off Script, as the sprint decides (session.js).
const GOES = { none: () => 1, auto: (s, now, k) => (helpFirst(s, now, k) ? 2 : 1), letters: () => 2, read: () => 2.5 };

// Minutes at his pace (paceOf in plan.js): a line not started yet at the pace of learning, others at
// the pace of runs. now and k: the moment and his personal factor, for the chance of recall.
export function practiceMinutes({ index, getState, itemIds, help, pace, now = Date.now(), k = 1 }) {
  let sec = 0;
  for (const id of itemIds) {
    const s = getState(id);
    const words = index.byId.get(id).words;
    sec += s.status === 'new' ? words * pace.newSecPerWord : GOES[help](s, now, k) * words * pace.runSecPerWord;
  }
  return sec / 60;
}
