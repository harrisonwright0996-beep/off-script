// Walk: practice with earbuds in and the phone in a pocket. With an audio pack the plan becomes one
// tape that plays with the screen locked: a double tap on an earbud (next track) marks the line just
// heard as missed, and back replays it. Without a pack the phone's own voice reads the same tape with
// the screen kept on, and two big buttons do the marking. Afterwards he checks the list, and the
// results are saved at the moments they were heard.
import { h, clear, screen, button, announce, focusHeading, plural, settled } from './dom.js';
import { buildWalk, trialAt, partAt, reviewRows, walkResults, walkRecords } from '../tape.js';
import { tapeBlob, createPlayer, keepScreenOn } from '../player.js';
import { canSpeak, speak, stopSpeaking } from '../tts.js';
import { tokenize, keyedCount, joinTokens } from '../tokens.js';
import { duration } from '../plan.js';

const LENGTHS = [15, 30, 45, 60, 90];

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
  return { version: 1, scriptHash: model.hash, silence: { file: 'silence', duration: 0.25 }, items, speakers, headings };
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
  return texts;
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

  async function build(minutes) {
    length = minutes;
    page('Walk', [h('p', { class: 'lead', role: 'status' }, 'Getting the walk ready…')], []);
    await ctx.refreshEvents();
    ctx.refit();
    const plan = ctx.plan();
    const manifest = ctx.manifest || speechManifest(ctx.model);
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
    if (tape.missing) about.push(h('p', { class: 'help' }, `${plural(tape.missing, 'line')} have no audio in the pack, so they are left out.`));
    if (ctx.manifest) audioWalk(tape, plan, about);
    else speechWalk(tape, plan, clipTexts(manifest, ctx.model), about);
  }

  // Wall clock times for answers as they are heard, so results are saved when they happened.
  function clock(tape) {
    const heard = new Map();
    let upTo = 0;
    return {
      heard,
      at(tapeTime, wall = Date.now()) {
        while (upTo < tape.trials.length && tape.trials[upTo].answerEnd <= tapeTime) {
          if (!heard.has(upTo)) heard.set(upTo, wall - (tapeTime - tape.trials[upTo].answerEnd) * 1000);
          upTo += 1;
        }
      },
      rewind(tapeTime) {
        upTo = Math.max(0, tape.trials.findIndex((t) => t.answerEnd > tapeTime));
        if (upTo < 0) upTo = tape.trials.length;
      },
    };
  }

  async function audioWalk(tape, plan, about) {
    const names = [...new Set(tape.steps.filter((s) => s.clip).map((s) => s.clip)), ctx.manifest.silence.file];
    const clips = await ctx.store.getClips(names);
    const blob = tapeBlob(tape.steps, clips, clips.get(ctx.manifest.silence.file));
    const marked = new Set();
    const times = clock(tape);
    let started = null;
    let label = partAt(tape.parts, 0);
    const partEl = h('p', { class: 'lead' }, label);
    const countEl = h('p', { role: 'status' }, 'Nothing marked yet.');
    const fill = h('div', { class: 'timebar-fill', style: { width: '0%' } });
    const bar = h('div', { class: 'timebar', role: 'img', 'aria-label': 'How far through the walk' }, fill);

    const mark = (t) => {
      const i = trialAt(tape.trials, t);
      if (i < 0) return;
      marked.add(i);
      countEl.textContent = `${plural(marked.size, 'line')} marked as missed.`;
      announce('Marked');
    };
    const replay = (t) => {
      const i = trialAt(tape.trials, t);
      if (i < 0) return;
      const from = tape.trials[i].replayFrom ?? tape.trials[i].start;
      player.seek(from);
      times.rewind(from);
    };
    const player = createPlayer({
      onMark: mark,
      onReplay: replay,
      onTime: (t) => {
        times.at(t);
        fill.style.width = `${Math.min(100, (100 * t) / tape.duration)}%`;
        const now = partAt(tape.parts, t);
        if (now !== label) {
          label = now;
          partEl.textContent = now;
          player.setInfo(now, 'Off Script');
        }
      },
      onEnded: () => review(tape, plan, marked, Infinity, started, times),
      onError: () => {
        player.destroy();
        speechWalk(tape, plan, clipTexts(ctx.manifest, ctx.model), [h('p', { class: 'message' }, 'The tape would not play, so the phone will read it aloud instead.')]);
      },
    });
    player.load(blob, { title: partAt(tape.parts, 0), artist: 'Off Script' });
    ctx.walk = { tape, player }; // for browser tests

    const playBtn = button('Play', async () => {
      if (player.paused) {
        if (started === null) started = Date.now();
        await player.play().catch(() => {});
      } else player.pause();
    }, { class: 'btn primary big' });
    player.audio.addEventListener('play', () => (playBtn.textContent = 'Pause'));
    player.audio.addEventListener('pause', () => (playBtn.textContent = 'Play'));

    page(
      'Walk',
      [...about, partEl, bar, countEl, h('p', { class: 'help' }, 'Missed one? Double tap an earbud, or tap Missed that one. To hear a line again, press back on the earbuds.')],
      [
        playBtn,
        h('div', { class: 'row' }, button('Missed that one', () => mark(player.time)), button('Hear it again', () => replay(player.time))),
        button('End walk', settled(() => {
          const at = player.time;
          player.pause();
          review(tape, plan, marked, started === null ? 0 : at, started, times);
        })),
      ],
      () => {
        player.destroy();
        ctx.go('today');
      },
    );
    teardown = () => player.destroy();
  }

  async function speechWalk(tape, plan, texts, about) {
    const marked = new Set();
    const times = clock(tape);
    const starts = [];
    let t = 0;
    for (const s of tape.steps) {
      starts.push(t);
      t += s.dur;
    }
    let pos = 0;
    let playing = false;
    let started = null;
    let skip = null; // ends the current gap early
    let release = () => {};
    const partEl = h('p', { class: 'lead' }, partAt(tape.parts, 0));
    const countEl = h('p', { role: 'status' }, 'Nothing marked yet.');
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
      speak('Walk starting.', { voiceURI: ctx.settings.voiceURI, rate: ctx.settings.rate });
      release = await keepScreenOn();
      run();
    }, { class: 'btn primary big' });

    const tap = (missed) => {
      const i = trialAt(tape.trials, now() + 0.01);
      if (missed && i >= 0) {
        marked.add(i);
        countEl.textContent = `${plural(marked.size, 'line')} marked as missed.`;
        announce('Marked');
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
        partEl,
        countEl,
        h('p', { class: 'help' }, 'Keep the screen on. Tap Got it to move on sooner.'),
      ],
      [
        playBtn,
        h('div', { class: 'halves' }, button('Missed', () => tap(true)), button('Got it', () => tap(false))),
        button('End walk', settled(() => finish(started === null ? 0 : now()))),
      ],
      () => {
        playing = false;
        stopSpeaking();
        release();
        ctx.go('today');
      },
    );
    teardown = () => {
      playing = false;
      stopSpeaking();
      if (skip) skip();
      release();
    };
  }

  function review(tape, plan, marked, stoppedAt, started, times) {
    teardown();
    teardown = () => {};
    const rows = reviewRows(tape, marked, stoppedAt);
    let saving = false;
    if (!rows.length) {
      return page('Walk ended', [h('p', { class: 'lead' }, 'Nothing was heard all the way through, so there is nothing to save.')], [
        button('Back to Today', settled(() => ctx.go('today')), { class: 'btn primary' }),
      ]);
    }
    const list = h(
      'ul',
      { class: 'review-list' },
      rows.map((row, i) => {
        const it = ctx.index.byId.get(row.id);
        const words = joinTokens(it.tokens.slice(0, 8));
        const id = `row-${i}`;
        return h(
          'li',
          {},
          h(
            'label',
            { for: id },
            h('input', { id, type: 'checkbox', checked: row.ticked, onChange: (e) => (row.ticked = e.target.checked) }),
            h('span', {}, h('strong', {}, it.speaker), ': ', words, it.tokens.length > 8 ? '…' : ''),
          ),
        );
      }),
    );
    page(
      'How did it go?',
      [h('p', { class: 'lead' }, `${plural(rows.length, 'line')} on this walk. Tick any you missed; the ones you marked are ticked already.`), list],
      [
        button('All good apart from the ticked ones', settled(async () => {
          if (saving) return; // saved once, however many taps
          saving = true;
          const start = started ?? Date.now();
          const results = walkResults(tape, rows, marked).map((r) => ({ ...r, at: times.heard.has(r.trial) ? (times.heard.get(r.trial) - start) / 1000 : r.at }));
          const records = walkRecords(results, { start, getState: ctx.getState, k: plan.k });
          for (const rec of records) await ctx.saveAnswer(rec);
          ctx.refit();
          const missed = rows.filter((r) => r.ticked).length;
          announce('Walk saved');
          page('Walk saved', [h('p', { class: 'lead' }, `${plural(rows.length, 'line')}, ${missed ? `${missed} to look at again` : 'all word perfect'}.`)], [
            button(`Another ${length} minutes`, settled(() => build(length)), { class: 'btn primary' }),
            button('A different length', settled(choose)),
            button('Back to Today', settled(() => ctx.go('today'))),
          ]);
        }), { class: 'btn primary' }),
        button('Don’t count this one', settled(() => !saving && ctx.go('today'))),
      ],
    );
  }

  choose();
  return () => teardown();
}
