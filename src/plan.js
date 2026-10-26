// Today's plan, worked out afresh whenever it is asked for (before every card): from every line's
// memory (memory.js), recent results, settings, the date and the time. There is no timetable.
// Ready to test: a learned line whose chance of recall has fallen to its target (90%, or 95% for a
// scene opening), or that was missed and not yet relearned, or that has gone too long untested for
// the date (3 days while learning and in show week, 14 days in between; every line every day in the
// final days before off script day and before show week, and on off script day).
// Tests: a stretch of ready lines in flow (whole scenes from the top in the final days, the weakest
// scene first), otherwise the line on its own from its cue. Most at risk first.
// New: whole beats in running order, up to today's share of what is left (a little more than an even
// spread, so more comes while reviews are light). The sprint puts the tests in between the new beats.
// It adapts both ways: the share is what is left over the days left, so a big day makes later days
// lighter and a missed day spreads out quietly; the curve is fitted to his own results; times come
// from his own pace; once today's plan is done, "keep going" work is ready.
import { addDays, dayEnd, daysBetween, formatDay, weekday } from './dates.js';
import { category, isWordPerfect, needsTeaching } from './state.js';
import { fnv1a, spineItemIds } from './items.js';
import { HOUR, OPENING_TARGET, TARGET, fitFactor, readyAt, recallNow, retrievability } from './memory.js';

export const RUN_MIN = 4; // ready lines needed for a run in flow
export const RUN_DENSITY = 0.6; // share of a stretch that must be ready
export const RUN_GAP = 2; // lines not ready that a stretch can step over
export const REVIEW_BURST = 6; // tests in a row before the next new beat

export const FINAL_DAYS = 3; // the days before show week that are final days again
export const SHOW_WEEK = 7;

// Learning, the final days, off script day, then maintenance until the final days before show week
// (the second peak), show week itself, and maintenance again.
export function phaseOf(day, settings) {
  if (day <= settings.lastNewDay) return 'learning';
  if (day < settings.deadline) return 'final';
  if (day === settings.deadline) return 'deadline';
  const show = settings.showDay;
  if (show && show > settings.deadline) {
    if (day < show && day >= addDays(show, -FINAL_DAYS)) return 'final';
    if (day >= show && day < addDays(show, SHOW_WEEK)) return 'show';
  }
  return 'maintenance';
}

// 'done' when every item has reached review, 'learn' while any item is still to be taught (never yet
// right, with or without the first letters), otherwise 'run' (the beat needs running from its first cue).
export function beatStage(beat, getState) {
  const states = beat.itemIds.map(getState);
  if (states.every((s) => s.status === 'review')) return 'done';
  if (states.some(needsTeaching)) return 'learn';
  return 'run';
}

// One outcome per check: a go with the first letters right is practice before the check, not a check,
// and the goes after a miss in the same sprint are relearning.
export const isCheck = (e) => !e.relearn && !(e.help && e.pass);

// The same order all day, a different order each day.
export function dayOrder(ids, day) {
  const h = new Map(ids.map((id) => [id, parseInt(fnv1a(day + id), 36)]));
  return [...ids].sort((a, b) => h.get(a) - h.get(b));
}

// New work, from his most recent checks of learned lines before today: the last 100 (at least 40
// are needed; sprints only, since walks are marked from memory afterwards), the ones he got right
// against the number his forgetting curve expected for those same checks. Bad luck alone often costs
// a few points, so a shortfall of up to 3 points changes nothing; beyond that new work is cut
// smoothly (5% for each point more), to no less than half, so there is more time for what is learned.
export const GATE = { window: 100, min: 40, slack: 0.03, slope: 5, floor: 0.5 };

export function recallGate(events, { before = Infinity, k = 1 } = {}) {
  const checks = events
    .filter((e) => e.time < before && e.mode !== 'walk' && e.prev && e.prev.status === 'review' && e.prev.stability && e.prev.lastTime && isCheck(e))
    .sort((a, b) => a.time - b.time)
    .slice(-GATE.window);
  const passes = checks.filter((e) => e.pass).length;
  const expected = checks.reduce((n, e) => n + retrievability((e.time - e.prev.lastTime) / HOUR, k * e.prev.stability), 0);
  const shortfall = checks.length ? (expected - passes) / checks.length : 0;
  const cut = checks.length >= GATE.min ? GATE.slope * (shortfall - GATE.slack) : 0;
  return { total: checks.length, passes, expected, factor: Math.min(1, Math.max(GATE.floor, 1 - cut)) };
}

// Today's share of the new words still to start, against an even spread over the days left.
export const FRONT_LOAD = 1.25;

// How many days a learned line may go untested, whatever the curve says. 0: once every day.
export const maxDays = (phase) => (phase === 'learning' || phase === 'show' ? 3 : phase === 'maintenance' ? 14 : 0);

const targetOf = (openings, id) => (openings.has(id) ? OPENING_TARGET : TARGET);

// The learned lines ready to test now, each with its chance of recall (0 for a miss not yet relearned).
export function readyLines({ model, getState, now, today, k, phase }) {
  const openings = new Set(spineItemIds(model));
  const cap = maxDays(phase);
  const ready = new Map();
  for (const it of model.items) {
    const s = getState(it.id);
    if (s.status !== 'review') continue;
    const r = s.lastResult === 'miss' ? 0 : recallNow(s, now, k) ?? 0;
    const stale = cap === 0 ? s.lastDay < today : daysBetween(s.lastDay, today) >= cap;
    if (r <= targetOf(openings, it.id) || stale) ready.set(it.id, r);
  }
  return ready;
}

// A scene's learned lines in order, starting from the beat holding the weakest of the given lines.
function fromWeakest(index, learned, weak, recall) {
  if (!weak.length) return learned;
  const weakest = weak.reduce((a, b) => (recall(b) < recall(a) ? b : a));
  const beat = index.byId.get(weakest).beat;
  const start = learned.findIndex((id) => index.byId.get(id).beat === beat);
  return [...learned.slice(start), ...learned.slice(0, start)];
}

// The tests ready now, most at risk first: { kind: 'run', scene, itemIds, total, r } for a stretch in
// flow, { kind: 'line', id, r } for a line on its own. Lines learned together fall due together, so
// ready lines come in stretches: a stretch with at least four ready lines, at least 60% of it ready,
// is run in flow from its first ready line; other ready lines are tested on their own. In the final
// days every scene is run whole from the top: those with a miss first, then the weakest scene first
// (the lowest chance of recall in it), so a short day still covers the scenes most at risk.
export function testsOf({ model, index, getState, ready, phase, today }) {
  const whole = phase === 'final' || phase === 'deadline';
  const tests = [];
  const inRuns = new Set();
  const rOf = (ids) => Math.min(...ids.map((id) => ready.get(id)));
  for (const sc of model.scenes) {
    const learned = sc.itemIds.filter((id) => getState(id).status === 'review');
    const due = learned.filter((id) => ready.has(id));
    if (!due.length) continue;
    if (whole && due.length === learned.length) {
      tests.push({ kind: 'run', scene: sc.index, itemIds: learned, total: learned.length, r: rOf(due) });
      due.forEach((id) => inRuns.add(id));
      continue;
    }
    const stretches = [];
    let cur = null;
    learned.forEach((id, i) => {
      if (!ready.has(id)) return;
      if (cur && i - cur.last <= RUN_GAP + 1) {
        cur.last = i;
        cur.ready.push(id);
      } else stretches.push((cur = { first: i, last: i, ready: [id] }));
    });
    for (const st of stretches) {
      const span = learned.slice(st.first, st.last + 1);
      if (st.ready.length < RUN_MIN || st.ready.length / span.length < RUN_DENSITY) continue;
      tests.push({ kind: 'run', scene: sc.index, itemIds: span, total: span.length, r: rOf(st.ready) });
      st.ready.forEach((id) => inRuns.add(id));
    }
  }
  for (const [id, r] of ready) if (!inRuns.has(id)) tests.push({ kind: 'line', id, r });
  const rank = new Map(dayOrder([...ready.keys()], today).map((id, i) => [id, i]));
  const first = (t) => rank.get(t.kind === 'run' ? t.itemIds[0] : t.id) ?? 0;
  const group = (t) => (t.r === 0 ? 0 : whole && t.kind === 'run' ? 1 : 2);
  return tests.sort((a, b) => group(a) - group(b) || a.r - b.r || (group(a) === 1 ? a.scene - b.scene : first(a) - first(b)));
}

// Keep going: every scene with learned lines, the least secure first, from its weakest beat.
export function extraRunsOf({ model, index, getState, now, k, skip = new Set() }) {
  const recall = (id) => recallNow(getState(id), now, k) ?? 0;
  return model.scenes
    .map((sc) => {
      const learned = sc.itemIds.filter((id) => getState(id).status === 'review');
      const mean = learned.reduce((n, id) => n + recall(id), 0) / (learned.length || 1);
      const itemIds = fromWeakest(index, learned, learned, recall);
      return { kind: 'run', scene: sc.index, itemIds, total: itemIds.length, r: mean };
    })
    .filter((r) => r.itemIds.length && !skip.has(r.scene))
    .sort((a, b) => a.r - b.r || a.scene - b.scene);
}

// Typical speeds until his own are measured.
export const DEFAULT_PACE = { newSecPerWord: 4, runSecPerWord: 0.8, dueSecPerItem: 20 };
const GAP_CAP = 150; // a longer gap between answers was a break: count it as one quick card
const FIRST_CARD = 20;

// Seconds spent before each answer, from the answers' own times.
export function activeTime(events) {
  const sorted = [...events].sort((a, b) => a.time - b.time);
  let prev = null;
  return sorted.map((e) => {
    const gap = prev && prev.day === e.day ? (e.time - prev.time) / 1000 : Infinity;
    prev = e;
    return { e, sec: gap <= GAP_CAP ? gap : FIRST_CARD };
  });
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// His measured pace over today and the three days before, and his practice time.
export function paceOf(events, today, byId) {
  const days = [0, 1, 2, 3].map((k) => addDays(today, -k));
  const timed = activeTime(events.filter((e) => days.includes(e.day)));
  const t = { new: 0, newWords: 0, run: 0, runWords: 0, due: 0, dueTests: 0 };
  const secByDay = new Map(days.map((d) => [d, 0]));
  for (const { e, sec } of timed) {
    secByDay.set(e.day, secByDay.get(e.day) + sec);
    if (e.mode === 'walk') continue; // walks run at the tape's speed, not his
    const words = byId.get(e.id)?.words ?? 0;
    if (e.queue === 'new' || e.queue === 'beat') {
      t.new += sec;
      if (e.prev && e.prev.status === 'new') t.newWords += words;
    } else if (e.queue === 'run') {
      t.run += sec;
      if (isCheck(e)) t.runWords += words;
    } else if (e.queue === 'due') {
      t.due += sec;
      if (isCheck(e)) t.dueTests += 1; // a check, with its first letters go and any relearning
    }
  }
  const measured = t.newWords >= 60;
  const prior = days.slice(1).map((d) => secByDay.get(d));
  return {
    measured,
    newSecPerWord: measured ? clamp(t.new / t.newWords, 1, 15) : DEFAULT_PACE.newSecPerWord,
    runSecPerWord: t.runWords >= 60 ? clamp(t.run / t.runWords, 0.3, 5) : DEFAULT_PACE.runSecPerWord,
    dueSecPerItem: t.dueTests >= 8 ? clamp(t.due / t.dueTests, 5, 120) : DEFAULT_PACE.dueSecPerItem,
    todayMinutes: secByDay.get(today) / 60,
    minutesPerDay: prior.some((s) => s > 0) ? prior.reduce((a, b) => a + b, 0) / prior.length / 60 : null,
  };
}

const num = (n) => Math.round(n).toLocaleString('en-GB');
const round5 = (min) => Math.max(5, Math.round(min / 5) * 5);

// '45 minutes', '1 hour', '1 hour 40 minutes'.
export function duration(minutes) {
  const m = round5(minutes);
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  const hs = hours ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '';
  const ms = rest ? `${rest} minutes` : '';
  return [hs, ms].filter(Boolean).join(' ');
}

// 'in about 25 minutes', 'in about 2 hours', 'tomorrow'.
export function untilText(ms, now, today) {
  if (ms >= dayEnd(today)) return 'tomorrow';
  const min = Math.max(1, (ms - now) / 60000);
  if (min < 55) return `in about ${Math.max(5, Math.round(min / 5) * 5)} minutes`;
  const h = Math.round(min / 60);
  return `in about ${h} ${h === 1 ? 'hour' : 'hours'}`;
}

export function buildPlan({ model, index, getState, events, settings, today, now = Date.now(), fit = fitFactor(events) }) {
  const { byId, beatById } = index;
  const { k } = fit;
  const phase = phaseOf(today, settings);
  const words = (ids) => ids.reduce((n, id) => n + byId.get(id).words, 0);
  const isNew = (id) => getState(id).status === 'new';
  const allLearned = model.items.every((it) => getState(it.id).status === 'review');
  const notes = [];

  // Tests of what is already learned.
  const ready = readyLines({ model, getState, now, today, k, phase });
  const tests = testsOf({ model, index, getState, ready, phase, today });
  const runs = tests.filter((t) => t.kind === 'run');
  const due = tests.filter((t) => t.kind === 'line').map((t) => t.id);
  const extraRuns = extraRunsOf({ model, index, getState, now, k, skip: new Set(runs.map((r) => r.scene)) });

  // New: beats already started, then new beats in running order up to today's share.
  const newRemaining = model.items.filter((it) => isNew(it.id)).reduce((n, it) => n + it.words, 0);
  const startedOn = (d) => model.items.filter((it) => getState(it.id).firstDay === d).reduce((n, it) => n + it.words, 0);
  const startedToday = startedOn(today);
  const finalEnd = today < settings.deadline ? settings.deadline : settings.showDay;
  const target = phase === 'learning' ? settings.lastNewDay : phase === 'final' ? addDays(finalEnd, -1) : addDays(today, 2);
  const daysLeft = Math.max(1, daysBetween(today, target) + 1);
  const fullQuota = Math.ceil((newRemaining + startedToday) * Math.min(1, FRONT_LOAD / daysLeft));
  const gate = recallGate(events, { before: dayEnd(addDays(today, -1)), k });
  const quota = Math.ceil(fullQuota * gate.factor);
  const newBeats = model.beats.filter((b) => beatStage(b, getState) !== 'done' && !b.itemIds.every(isNew)).map((b) => b.id);
  const focus = settings.focusScene;
  const ordered = focus == null ? model.beats : [...model.beats.filter((b) => b.scene === focus), ...model.beats.filter((b) => b.scene !== focus)];
  let allowance = quota - startedToday;
  const ahead = []; // beyond the share: a head start, offered once today's plan is done
  for (const b of ordered) {
    if (!b.itemIds.every(isNew)) continue;
    if (allowance > 0) {
      newBeats.push(b.id);
      allowance -= b.words;
    } else if (ahead.length < 6) ahead.push(b.id);
    else break;
  }

  // When the next line falls to its target, if nothing is ready now.
  const openings = new Set(spineItemIds(model));
  let nextAt = null;
  let later = 0; // lines that will fall to their target before today ends
  const end = dayEnd(today);
  for (const it of model.items) {
    const s = getState(it.id);
    if (s.status !== 'review' || ready.has(it.id)) continue;
    const at = readyAt(s, k, targetOf(openings, it.id));
    if (nextAt === null || at < nextAt) nextAt = at;
    if (at < end) later += 1;
  }

  // Time left today, at his own pace: what is ready, the new lines, and the checks still to come
  // today (about two more for each new line).
  const pace = paceOf(events, today, byId);
  const newIds = newBeats.flatMap((id) => beatById.get(id).itemIds).filter((id) => getState(id).status !== 'review');
  const newWords = words(newIds);
  const runIds = runs.flatMap((r) => r.itemIds);
  later += newIds.length * 2;
  const reviewSec = due.length * pace.dueSecPerItem + words(runIds) * pace.runSecPerWord + later * pace.dueSecPerItem;
  const leftSec = reviewSec + newWords * pace.newSecPerWord;
  const done = tests.length === 0 && newIds.length === 0;
  const estimate = leftSec === 0 ? { low: 0, high: 0 } : { low: round5((leftSec * 0.85) / 60), high: round5((leftSec * 1.2) / 60) };

  // One kind, factual line about pace. Never a streak, never red.
  const when = (d) => (daysBetween(today, d) < 7 ? weekday(d) : formatDay(d));
  const atPace = pace.measured ? 'at your pace' : 'at a typical pace';
  let forecast;
  if (newRemaining === 0) {
    forecast = newIds.length
      ? 'Every speech is started. Finish the beats in progress, then it is checks and runs.'
      : 'Every speech is learned. Checks and runs keep it word perfect.';
  } else {
    const prior = [1, 2, 3].map((d) => startedOn(addDays(today, -d)));
    const perDay = Math.max(prior.reduce((a, b) => a + b, 0) / 3, startedToday);
    const remainingAfterToday = Math.max(0, newRemaining - Math.max(0, quota - startedToday));
    const finish = perDay > 0 ? addDays(today, Math.ceil((startedToday >= perDay ? newRemaining : remainingAfterToday) / perDay)) : null;
    const needed = duration((reviewSec + fullQuota * pace.newSecPerWord) / 60);
    if (finish && finish <= target) forecast = `At this pace every scene is started by ${when(finish)}.`;
    else if (finish) forecast = `At this pace every scene is started by ${when(finish)}. About ${needed} today ${atPace} keeps it on track for ${when(target)}.`;
    else forecast = `To start every scene by ${when(target)}, aim for about ${num(fullQuota)} new words today: about ${needed} ${atPace}.`;
  }

  if (gate.factor < 1) {
    const fewer = Math.max(5, Math.round(((1 - gate.factor) * 100) / 5) * 5);
    notes.push(
      `Your last ${gate.total} checks had ${gate.passes} word perfect, where your forgetting curve expected about ${Math.round(gate.expected)}. So today has about ${fewer}% fewer new lines, and more time for what you know.`,
    );
  }
  if (fit.n >= 50 && k >= 1.25) notes.push('Your lines are lasting longer than expected, so checks are spaced further apart.');
  if (fit.n >= 50 && k <= 0.8) notes.push('Your lines are slipping a little sooner than expected, so checks come round sooner.');
  if (phase === 'learning' && allLearned) notes.push('Every line is learned, ahead of plan. From now on it is checks and runs.');
  if (phase === 'final') notes.push('Final days: every learned line every day, whole scenes from the top, the weakest first.');
  if (phase === 'final' && newRemaining > 0) notes.push(`${num(newRemaining)} words are still new. They come in between the runs today.`);
  if (today === addDays(settings.deadline, -1) || today === addDays(settings.showDay, -1)) notes.push('Today, do at least one whole run in Type or Say mode. It is the precise check.');
  if (phase === 'deadline') notes.push('Off script day. One run of the whole play today, and Walk is ideal.');
  if (phase === 'show') notes.push('Show week. Short checks keep every line at its peak; anything missed comes first next time.');
  const lastActive = model.items.reduce((d, it) => {
    const l = getState(it.id).lastDay;
    return l && l > d ? l : d;
  }, '');
  if (lastActive && lastActive < today && daysBetween(lastActive, today) >= 2) {
    notes.push('Welcome back. The plan has been rebalanced around today.');
  }

  return {
    day: today,
    now,
    phase,
    k,
    ready,
    tests,
    due,
    runs,
    extraRuns,
    newBeats,
    ahead,
    done,
    nextAt,
    quota,
    gate,
    pace,
    estimate,
    forecast,
    notes,
    counts: {
      due: due.length,
      runItems: runIds.length,
      runWords: words(runIds),
      runScenes: runs.length,
      newItems: newIds.length,
      newWords,
      later,
    },
    progress: progressOf(model, index, getState),
  };
}

// Words and speeches by scene for the map and the headline.
export function progressOf(model, index, getState) {
  const { byId } = index;
  const scenes = model.scenes.map((sc) => {
    const seg = { new: 0, learning: 0, perfect: 0, missed: 0 };
    for (const id of sc.itemIds) seg[category(getState(id))] += byId.get(id).words;
    const speeches = sc.reader.filter((r) => r.t === 'speech' && r.itemIds.length);
    const perfect = speeches.filter((r) => r.itemIds.every((id) => isWordPerfect(getState(id)))).length;
    return { scene: sc.index, heading: sc.heading, words: sc.words, seg, speeches: speeches.length, perfectSpeeches: perfect };
  });
  return {
    scenes,
    perfectWords: scenes.reduce((n, s) => n + s.seg.perfect, 0),
    totalWords: model.totals.words,
  };
}
