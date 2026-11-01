// Walk: practice with earbuds in and the phone in a pocket. With an audio pack the plan becomes one
// tape that plays with the screen locked: a double tap on an earbud (next track) marks the line just
// heard as missed, and back replays it. Without a pack the phone's own voice reads the same tape with
// the screen kept on, and two big buttons do the marking. Afterwards he checks the list, and the
// results are saved at the moments they were heard.
import { h, clear, screen, button, announce, focusHeading, plural, settled } from './dom.js';
import { buildWalk, markTrial, markedLines, partAt, replayPoint, resumePoint, reviewRows, walkResults, walkRecords } from '../tape.js';
import { tapeBlob, createPlayer, keepScreenOn } from '../player.js';
import { canSpeak, speak, stopSpeaking } from '../tts.js';
import { tokenize, keyedCount, joinTokens } from '../tokens.js';
import { duration } from '../plan.js';
import { COACH_SPEECH } from '../coach.js';
import { WALK_COUNTS } from '../streak.js';
import { rewardCard } from './badges.js';

const LENGTHS = [15, 30, 45, 60, 90];
const DRAFT = 'walkDraft'; // what a walk heard, until it is saved or let go
const READY = 'Press Play when you are ready';

// For walks without an audio pack: the same shape as a pack, with each "clip" naming what to say
// and lasting about as long as it takes to say it.
export function speechManifest(model) {
  const est = (text) => Math.max(0.8, keyedCount(tokenize(text)) / 2.5 + 0.4);
  const clip = (file, text) => ({ file, duration: est(text) });
  const items = {};
  for (const it of model.items) {
    items[it.id] = { line: clip(`line:${it.id}`, it.text), cue: it.cue.speaker === null ? null : clip(`cue:${it.id}`, it.cue.text) };
  }
  const speakers = {};
  for (const it of model.items) speakers[it.speaker] ||= clip(`speaker:${it.speaker}`, it.speaker);
  const headings = {};
  model.scenes.forEach((sc) => (headings[sc.index] = clip(`heading:${sc.index}`, sc.heading)));
  const coach = Object.fromEntries(Object.entries(COACH_SPEECH).map(([key, text]) => [key, clip(`coach:${key}`, text)]));
  return { version: 1, scriptHash: model.hash, silence: { file: 'silence', duration: 0.25 }, items, speakers, headings, coach };
}

// What each clip in a manifest says, so any tape can also be read aloud.
export function clipTexts(manifest, model) {
  const texts = new Map();
  for (const it of model.items) {
    const m = manifest.items[it.id];
    if (!m) continue;
    texts.set(m.line.file, it.text);
    if (m.cue) texts.set(m.cue.file, it.cue.text);
  }
  for (const [name, ref] of Object.entries(manifest.speakers)) texts.set(ref.file, name);
  for (const [i, ref] of Object.entries(manifest.headings)) if (model.scenes[i]) texts.set(ref.file, model.scenes[i].heading);
  for (const [key, ref] of Object.entries(manifest.coach || {})) texts.set(ref.file, COACH_SPEECH[key]);
  return texts;
}

// A walk that ended with its review not saved, if it is still for this script.
export async function keptWalk(ctx) {
  const draft = await ctx.store.get(DRAFT);
  return draft && draft.trials.every((tr) => ctx.index.byId.has(tr.id)) ? draft : null;
}

export function showWalk(ctx) {
  let teardown = () => {};
  let length = null; // minutes asked for, so another walk the same length is one tap

  function page(title, body, footer, back = () => ctx.go('today')) {
    teardown();
    teardown = () => {};
    clear(ctx.root).append(screen({ title, back, body, footer }));
    focusHeading(ctx.root);
  }

  function choose() {
    const pack = !!ctx.manifest;
    page(
      'Walk',
      [
        h('p', { class: 'lead' }, 'Earbuds in, phone in your pocket.'),
        h('p', { class: 'message' }, 'On paths and roads, keep one earbud out or use transparency mode.'),
        pack
          ? h('p', {}, 'Say each line in the gap before you hear it. Missed one? Double tap an earbud, or press next. Press back to hear it again.')
          : h('p', {}, 'There is no audio pack yet, so the phone reads aloud with the screen on. Say each line in the gap, then tap Missed or Got it.'),
        h('p', {}, 'A new line comes twice first: say it back in the gap after it. A few minutes later its beat runs from the cue.'),
        h('h2', {}, 'How long?'),
        h('div', { class: 'choice-grid' }, LENGTHS.map((m) => button(`${m} minutes`, settled(() => build(m)), { class: 'btn big' }))),
      ],
      [],
    );
  }

  // The coach unless it is turned off. A pack imported by an older version of the app came without
  // its coach clips: a walk then plays as it did before there was a coach.
  async function walkManifest() {
    const pack = ctx.manifest || speechManifest(ctx.model);
    const refs = Object.values(pack.coach || {});
    const clips = ctx.manifest ? await ctx.store.getClips(refs.map((r) => r.file)) : null;
    return ctx.settings.walkCoach && refs.every((r) => !clips || clips.has(r.file)) ? pack : { ...pack, coach: null };
  }

  async function build(minutes) {
    length = minutes;
    const nav = ctx.nav;
    page('Walk', [h('p', { class: 'lead', role: 'status' }, 'Getting the walk ready…')], []);
    await ctx.refreshEvents();
    if (ctx.nav !== nav) return;
    ctx.refit();
    const plan = ctx.plan();
    const manifest = await walkManifest();
    if (ctx.nav !== nav) return;
    const tape = buildWalk({
      model: ctx.model,
      index: ctx.index,
      manifest,
      getState: ctx.getState,
      settings: ctx.settings,
      plan,
      start: Date.now(),
      seconds: minutes * 60,
      gap: ctx.settings.walkGap,
    });
    if (!tape.trials.length) {
      return page('Nothing to walk yet', [h('p', { class: 'lead' }, 'There is nothing ready to practise on a walk right now.')], [
        button('Back to Today', settled(() => ctx.go('today')), { class: 'btn primary' }),
      ]);
    }
    const about = [h('p', {}, `This walk is about ${duration(tape.duration / 60)}.`)];
    if (tape.duration < minutes * 60 - 120) about.push(h('p', { class: 'help' }, 'It is shorter than asked because it covers everything useful for now. Start another later in the walk.'));
    if (tape.missing) about.push(h('p', { class: 'help' }, `${plural(tape.missing, 'line')} ${tape.missing === 1 ? 'has no audio in the pack, so it is' : 'have no audio in the pack, so they are'} left out.`));
    if (ctx.manifest) audioWalk(tape, plan, about, nav);
    else speechWalk(tape, plan, clipTexts(manifest, ctx.model), about);
  }

  // What has been heard and marked so far, kept as it goes: a reload or a closed app loses nothing.
  function keepDraft(tape, plan, marked, stoppedAt, started, heard) {
    return ctx.store.set(DRAFT, { trials: tape.trials, marked, stoppedAt, started, heard, k: plan.k, length }).catch(() => {});
  }

  // Wall clock times for answers as they are heard, so results are saved when they happened.
  // onHeard: called when another answer has been heard.
  function clock(tape, onHeard = () => {}) {
    const heard = new Map();
    let upTo = 0;
    return {
      heard,
      onHeard,
      at(tapeTime, wall = Date.now()) {
        const before = heard.size;
        while (upTo < tape.trials.length && tape.trials[upTo].answerEnd <= tapeTime) {
          if (!heard.has(upTo)) heard.set(upTo, wall - (tapeTime - tape.trials[upTo].answerEnd) * 1000);
          upTo += 1;
        }
        if (heard.size > before) this.onHeard(tapeTime);
      },
      rewind(tapeTime) {
        upTo = Math.max(0, tape.trials.findIndex((t) => t.answerEnd > tapeTime));
        if (upTo < 0) upTo = tape.trials.length;
      },
    };
  }

  // What to do now: on the screen and the lock screen, with the part of the walk it belongs to.
  const stepAt = (tape, t) => partAt(tape.guide, t) || READY;

  async function audioWalk(tape, plan, about, nav) {
    const names = [...new Set(tape.steps.filter((s) => s.clip).map((s) => s.clip)), ctx.manifest.silence.file];
    const clips = await ctx.store.getClips(names);
    if (ctx.nav !== nav) return;
    if (names.some((n) => !clips.has(n))) {
      return speechWalk(tape, plan, clipTexts(ctx.manifest, ctx.model), [...about, h('p', { class: 'message' }, 'Some of the audio is missing, so the phone will read it aloud instead.')]);
    }
    const blob = tapeBlob(tape.steps, clips, clips.get(ctx.manifest.silence.file));
    const marked = new Set();
    let started = null;
    let furthest = 0; // how far the tape has been heard: Hear it again goes back, not this
    const keep = () => started !== null && keepDraft(tape, plan, marked, furthest, started, times.heard);
    const times = clock(tape, keep);
    let label = stepAt(tape, 0);
    let part = partAt(tape.parts, 0);
    const stepEl = h('p', { class: 'lead guide' }, label);
    const partEl = h('p', { class: 'help' }, part);
    const countEl = h('p', { role: 'status' }, 'Nothing marked yet.');
    const fill = h('div', { class: 'timebar-fill', style: { width: '0%' } });
    const bar = h('div', { class: 'timebar', role: 'img', 'aria-label': 'How far through the walk' }, fill);

    const mark = (t) => {
      const i = markTrial(tape, t);
      if (i < 0) return;
      marked.add(i);
      countEl.textContent = `${plural(markedLines(tape, marked), 'line')} marked as missed.`;
      announce('Marked');
      keep();
    };
    const replay = (t) => {
      const from = replayPoint(tape, t);
      if (from === null) return;
      player.seek(from);
      times.rewind(from);
    };
    const player = createPlayer({
      onMark: mark,
      onReplay: replay,
      resumeFrom: (t) => {
        const from = resumePoint(tape, t);
        if (from !== null) times.rewind(from);
        return from;
      },
      onTime: (t) => {
        furthest = Math.max(furthest, t);
        times.at(t);
        fill.style.width = `${Math.min(100, (100 * t) / tape.duration)}%`;
        const [nowLabel, nowPart] = [stepAt(tape, t), partAt(tape.parts, t)];
        if (nowLabel !== label || nowPart !== part) {
          label = nowLabel;
          part = nowPart;
          stepEl.textContent = label;
          partEl.textContent = part;
          player.setInfo(label, part);
        }
      },
      onEnded: () => review(tape, plan, marked, Infinity, started, times),
      onError: () => {
        const at = player.time;
        player.destroy();
        speechWalk(tape, plan, clipTexts(ctx.manifest, ctx.model), [h('p', { class: 'message' }, 'The audio would not play, so the phone will read it aloud instead.')], { marked, times, started, at });
      },
    });
    player.load(blob, { title: label, artist: part });
    ctx.walk = { tape, player }; // for browser tests

    const playBtn = button('Play', async () => {
      if (player.paused) await player.play().catch(() => {});
      else player.pause();
    }, { class: 'btn primary big' });
    player.audio.addEventListener('play', () => {
      if (started === null) started = Date.now(); // the earbuds or the lock screen can start it too
      playBtn.textContent = 'Pause';
    });
    player.audio.addEventListener('pause', () => (playBtn.textContent = 'Play'));

    const endWalk = () => {
      furthest = Math.max(furthest, player.time);
      player.pause();
      review(tape, plan, marked, started === null ? 0 : furthest, started, times);
    };
    page(
      'Walk',
      [...about, stepEl, partEl, bar, countEl, h('p', { class: 'help' }, 'Missed one? Double tap an earbud, or tap Missed that one. To hear a line again, press back on the earbuds.')],
      [
        playBtn,
        h('div', { class: 'row' }, button('Missed that one', () => mark(player.time)), button('Hear it again', () => replay(player.time))),
        button('End walk', settled(endWalk)),
      ],
      settled(() => {
        if (started !== null) return endWalk(); // what was heard is not thrown away
        player.destroy();
        ctx.go('today');
      }),
    );
    teardown = () => player.destroy();
  }

  // carry: what an audio walk had got to, when its audio stopped working.
  async function speechWalk(tape, plan, texts, about, carry = null) {
    const marked = carry ? carry.marked : new Set();
    const keep = () => started !== null && keepDraft(tape, plan, marked, now(), started, times.heard);
    const times = carry ? carry.times : clock(tape, keep);
    times.onHeard = keep;
    const starts = [];
    let t = 0;
    for (const s of tape.steps) {
      starts.push(t);
      t += s.dur;
    }
    ctx.walk = { tape }; // for browser tests
    let pos = 0;
    if (carry) {
      const from = resumePoint(tape, carry.at) ?? carry.at;
      pos = Math.max(0, starts.findIndex((s) => s >= from - 1e-6));
    }
    let playing = false;
    let started = carry ? carry.started : null;
    let skip = null; // ends the current gap early
    let release = () => {};
    const stepEl = h('p', { class: 'lead guide' }, stepAt(tape, starts[pos]));
    const partEl = h('p', { class: 'help' }, partAt(tape.parts, starts[pos]));
    const countEl = h('p', { role: 'status' }, marked.size ? `${plural(markedLines(tape, marked), 'line')} marked as missed.` : 'Nothing marked yet.');
    const now = () => starts[Math.min(pos, starts.length - 1)] || 0;

    const wait = (sec) =>
      new Promise((resolve) => {
        const timer = setTimeout(resolve, sec * 1000);
        skip = () => {
          clearTimeout(timer);
          resolve();
        };
      });

    async function run() {
      while (playing && pos < tape.steps.length) {
        const step = tape.steps[pos];
        stepEl.textContent = stepAt(tape, starts[pos]);
        partEl.textContent = partAt(tape.parts, starts[pos]);
        if (step.clip) await speak(texts.get(step.clip) || '', { voiceURI: ctx.settings.voiceURI, rate: ctx.settings.rate });
        else await wait(step.dur);
        skip = null;
        if (!playing) return;
        pos += 1;
        times.at(pos < starts.length ? starts[pos] : tape.duration);
      }
      if (pos >= tape.steps.length) finish(Infinity);
    }

    const playBtn = button('Play', async () => {
      if (playing) {
        playing = false;
        stopSpeaking();
        if (skip) skip();
        playBtn.textContent = 'Play';
        return;
      }
      if (!canSpeak()) return;
      playing = true;
      playBtn.textContent = 'Pause';
      if (started === null) started = Date.now();
      else {
        const from = resumePoint(tape, now() + 0.01); // back to the line's cue
        if (from !== null) {
          pos = starts.findIndex((s) => s >= from - 1e-6);
          times.rewind(from);
        }
      }
      release = await keepScreenOn();
      run();
    }, { class: 'btn primary big' });

    const tap = (missed) => {
      const i = markTrial(tape, now() + 0.01);
      if (missed && i >= 0) {
        marked.add(i);
        countEl.textContent = `${plural(markedLines(tape, marked), 'line')} marked as missed.`;
        announce('Marked');
        keep();
      }
      if (skip && tape.steps[pos] && tape.steps[pos].silence) skip();
    };

    function finish(at) {
      playing = false;
      stopSpeaking();
      if (skip) skip();
      release();
      review(tape, plan, marked, at, started, times);
    }

    page(
      'Walk',
      [
        ...about,
        canSpeak() ? null : h('p', { class: 'message' }, 'This phone cannot read aloud here, so Walk needs an audio pack.'),
        stepEl,
        partEl,
        countEl,
        h('p', { class: 'help' }, 'Keep the screen on. Tap Got it to move on sooner.'),
      ],
      [
        playBtn,
        h('div', { class: 'halves' }, button('Missed', () => tap(true)), button('Got it', () => tap(false))),
        button('End walk', settled(() => finish(started === null ? 0 : now()))),
      ],
      settled(() => {
        if (started !== null) return finish(now()); // what was heard is not thrown away
        release();
        ctx.go('today');
      }),
    );
    teardown = () => {
      playing = false;
      stopSpeaking();
      if (skip) skip();
      release();
    };
  }

  // restored: a walk heard earlier, whose review was never saved.
  function review(tape, plan, marked, stoppedAt, started, times, restored = false) {
    teardown();
    teardown = () => {};
    const rows = reviewRows(tape, marked, stoppedAt);
    let saving = false;
    if (!rows.length) {
      const said = started === null ? 'You stopped before the walk began, so there is nothing to save.' : 'You stopped before your first go at a line, so there is nothing to save. The listening still helps.';
      return page('Walk ended', [h('p', { class: 'lead' }, said)], [
        button('Back to Today', settled(() => ctx.go('today')), { class: 'btn primary' }),
      ]);
    }
    // Kept until saved or let go: a phone can clear the page once the tape has ended.
    const kept = keepDraft(tape, plan, marked, stoppedAt, started, times.heard);
    const list = h(
      'ul',
      { class: 'review-list' },
      rows.map((row, i) => {
        const it = ctx.index.byId.get(row.id);
        const words = joinTokens(it.tokens.slice(0, 8));
        const id = `row-${i}`;
        const onChange = (e) => {
          row.ticked = e.target.checked;
          // Kept too, so a reload brings back the list as it was left.
          for (const t of row.trials) marked.delete(t);
          if (row.ticked) marked.add(row.trials[row.trials.length - 1]);
          keepDraft(tape, plan, marked, stoppedAt, started, times.heard);
        };
        return h(
          'li',
          {},
          h(
            'label',
            { for: id },
            h('input', { id, type: 'checkbox', checked: row.ticked, onChange }),
            h('span', {}, h('strong', {}, it.speaker), ': ', words, it.tokens.length > 8 ? '…' : ''),
          ),
        );
      }),
    );
    page(
      'How did it go?',
      [
        restored ? h('p', { class: 'message' }, 'Here is your last walk. It was kept for you.') : null,
        h('p', { class: 'lead' }, `${plural(rows.length, 'line')} on this walk. Tick any you missed; the ones you marked are ticked already.`),
        list,
      ],
      [
        button('All good apart from the ticked ones', settled(async () => {
          if (saving) return; // saved once, however many taps
          saving = true;
          const start = started ?? Date.now();
          let last = 0; // in tape order, whether heard or only marked
          const results = walkResults(tape, rows, marked).map((r) => {
            // A line marked while it was being taught has not been reached yet: never later than now.
            last = Math.max(last, times.heard.has(r.trial) ? (times.heard.get(r.trial) - start) / 1000 : Math.min(r.at, (Date.now() - start) / 1000));
            return { ...r, at: last };
          });
          const records = walkRecords(results, { start, getState: ctx.getState, k: plan.k });
          for (const rec of records) await ctx.saveAnswer(rec);
          if (records.reduce((n, r) => n + (r.event.active || 0), 0) >= WALK_COUNTS) ctx.streak.walks += 1;
          await kept;
          await ctx.store.del(DRAFT);
          ctx.refit();
          const missed = rows.filter((r) => r.ticked).length;
          announce('Walk saved');
          page('Walk saved', [rewardCard(ctx), h('p', { class: 'lead' }, `${plural(rows.length, 'line')}, ${missed ? `${missed} to look at again` : 'all word perfect'}.`)], [
            button(`Another ${length} minutes`, settled(() => build(length)), { class: 'btn primary' }),
            button('A different length', settled(choose)),
            button('Back to Today', settled(() => ctx.go('today'))),
          ]);
        }), { class: 'btn primary' }),
        button('Don’t count this one', settled(async () => {
          if (saving) return;
          await kept;
          await ctx.store.del(DRAFT);
          ctx.go('today');
        })),
      ],
    );
  }

  // A walk that ended with its review not saved comes first.
  async function restore() {
    const nav = ctx.nav;
    const draft = await keptWalk(ctx);
    if (ctx.nav !== nav || length !== null || !draft) return;
    length = draft.length;
    review({ trials: draft.trials }, { k: draft.k }, draft.marked, draft.stoppedAt, draft.started, { heard: draft.heard }, true);
  }

  choose();
  restore();
  return () => teardown();
}
