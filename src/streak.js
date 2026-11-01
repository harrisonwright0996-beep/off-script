// Streaks and badges. A round is 20 minutes of good practice: minutes spent answering lines or out on
// a walk, added up across the day however many sittings it takes. Time left on a card earns nothing
// past what the line could need, so a phone left open does not count. Two rounds a day is bronze,
// three silver, four gold, and each medal's streak runs by itself. None of this touches the plan.
import { addDays, daysBetween, weekStart } from './dates.js';
import { isWordPerfect } from './state.js';

export const ROUND_SECONDS = 20 * 60;
export const WALK_COUNTS = 120; // seconds of tape: a walk stopped sooner is not a walk for the badges
const WALK_APART = 3600000; // answers this far apart are two walks, in the record of past walks
const LINE_MOST = 120; // seconds a card can earn, however long the line
const LINE_START = 30; // the cue, and thinking
const LINE_WORD = 2; // and each word of the line

export const CUE_MOST = 30; // seconds a cue question can earn

export const MEDALS = [
  { name: 'Bronze', icon: '🥉', rounds: 2 },
  { name: 'Silver', icon: '🥈', rounds: 3 },
  { name: 'Gold', icon: '🥇', rounds: 4 },
];

export const BADGES = [
  { id: 'first-round', name: 'First Round', what: 'Finish a 20 minute round.' },
  { id: 'first-walk', name: 'First Walk', what: 'Go on a walk.' },
  { id: 'ten-walks', name: 'Ten Walks', what: 'Go on ten walks.' },
  { id: 'streak-3', name: '3 Day Streak', what: 'Keep a streak going for 3 days.' },
  { id: 'streak-7', name: '7 Day Streak', what: 'Keep a streak going for 7 days.' },
  { id: 'streak-14', name: '14 Day Streak', what: 'Keep a streak going for 14 days.' },
  { id: 'quarter', name: 'Quarter Way', what: 'A quarter of the words word perfect.' },
  { id: 'halfway', name: 'Halfway', what: 'Half of the words word perfect.' },
  { id: 'off-book', name: 'Off Book', what: 'Every word word perfect.' },
  { id: 'scene-lit', name: 'Scene Lit', what: 'Every word of a scene word perfect.' },
  { id: 'comeback', name: 'Comeback', what: 'Win back a line that slipped.' },
  { id: 'stage-ready', name: 'Stage Ready', what: 'Keep every word word perfect for 7 days.' },
];

// days: seconds of good practice, by day. slipped: lines that have stopped being word perfect. told:
// how many rounds of which day have been shown.
export const newStreak = () => ({ days: {}, walks: 0, badges: [], slipped: [], won: false, fullSince: null, told: null });
export const cleanStreak = (saved) => ({ ...newStreak(), ...(saved || {}) });

export function creditFor(event, words) {
  if (!(event.active > 0)) return 0;
  return event.mode === 'walk' ? event.active : Math.min(event.active, LINE_MOST, LINE_START + LINE_WORD * words);
}

export function addSeconds(rec, day, seconds) {
  const total = Math.round(((rec.days[day] || 0) + seconds) * 10) / 10;
  if (total > 0) rec.days[day] = total;
  else delete rec.days[day];
}

// The record, from the answers saved so far: for a phone that had practice before there were streaks,
// and for a backup put back.
export function rebuildStreak(events, index) {
  const rec = newStreak();
  let lastWalk = null;
  for (const e of [...events].sort((a, b) => a.time - b.time)) {
    const it = index.byId.get(e.id);
    if (!it) continue;
    addSeconds(rec, e.day, creditFor(e, it.words));
    if (e.mode !== 'walk') continue;
    if (lastWalk === null || e.time - lastWalk > WALK_APART) rec.walks += 1;
    lastWalk = e.time;
  }
  return rec;
}

// Winning back a line: it was word perfect, a miss took that away, and it has come back.
export function noteSlips(rec, before, after) {
  const was = !!before && isWordPerfect(before);
  const is = isWordPerfect(after);
  if (was && !is && !rec.slipped.includes(after.id)) rec.slipped.push(after.id);
  else if (!was && is && rec.slipped.includes(after.id)) {
    rec.slipped = rec.slipped.filter((id) => id !== after.id);
    rec.won = true;
  }
}

const roundsIn = (seconds = 0) => Math.floor(seconds / ROUND_SECONDS);
export const roundsOn = (rec, day) => roundsIn(rec.days[day]);

// One medal's streak up to today. Today only counts once it is won: until then the streak stands.
// The understudy covers one missed day a week (Monday to Sunday) and adds nothing to the count.
export function streakOf(days, rounds, today) {
  const first = Object.keys(days).sort()[0];
  let run = 0;
  let week = null;
  let used = false;
  let covered = null;
  if (!first) return { days: 0, covered };
  for (let day = first; day <= today; day = addDays(day, 1)) {
    const won = roundsIn(days[day]) >= rounds;
    if (day === today && !won) break;
    if (weekStart(day) !== week) {
      week = weekStart(day);
      used = false;
    }
    if (won) {
      run += 1;
      covered = null;
    } else if (run > 0 && !used) {
      used = true;
      covered = day;
    } else {
      run = 0;
      covered = null;
    }
  }
  return { days: run, covered };
}

// The longest of the three: a gold day is a bronze day too.
export const streakDays = (rec, today) => streakOf(rec.days, MEDALS[0].rounds, today).days;

export function statusOf(rec, today) {
  const seconds = rec.days[today] || 0;
  const rounds = roundsIn(seconds);
  const next = MEDALS.find((m) => rounds < m.rounds) ?? null;
  return {
    rounds,
    minutes: Math.floor((seconds % ROUND_SECONDS) / 60),
    next,
    more: next ? next.rounds - rounds : 0,
    medals: MEDALS.map((m) => ({ ...m, ...streakOf(rec.days, m.rounds, today) })),
  };
}

// Earns whatever has been reached and returns what is new. Each badge comes once, for good.
export function checkBadges(rec, { percent, lit, today }) {
  rec.fullSince = percent >= 100 ? (rec.fullSince ?? today) : null;
  const streak = streakDays(rec, today);
  const reached = {
    'first-round': Object.values(rec.days).some((s) => roundsIn(s) >= 1),
    'first-walk': rec.walks >= 1,
    'ten-walks': rec.walks >= 10,
    'streak-3': streak >= 3,
    'streak-7': streak >= 7,
    'streak-14': streak >= 14,
    quarter: percent >= 25,
    halfway: percent >= 50,
    'off-book': percent >= 100,
    'scene-lit': lit,
    comeback: rec.won,
    'stage-ready': !!rec.fullSince && daysBetween(rec.fullSince, today) >= 7,
  };
  const fresh = BADGES.filter((b) => reached[b.id] && !rec.badges.includes(b.id));
  rec.badges.push(...fresh.map((b) => b.id));
  return fresh;
}

// The medal won by the rounds done since `told`, if one was.
export function newRounds(rec, today) {
  const rounds = roundsOn(rec, today);
  const told = rec.told?.day === today ? rec.told.rounds : 0;
  rec.told = { day: today, rounds };
  if (rounds <= told) return null;
  return { rounds, medal: MEDALS.filter((m) => m.rounds > told && m.rounds <= rounds).pop() ?? null };
}

// The words word perfect, as a share: rounded down, so 100% only when every word is there.
export function wordPercent(items, getState) {
  const total = items.reduce((n, it) => n + it.words, 0);
  const perfect = items.filter((it) => isWordPerfect(getState(it.id))).reduce((n, it) => n + it.words, 0);
  return total ? Math.floor((100 * perfect) / total) : 0;
}
