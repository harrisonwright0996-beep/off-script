// Today: what the plan holds right now, how far the play has come, and one obvious next action.
// Worked out afresh whenever the screen opens or the phone comes back to it.
import { h, clear, screen, button, focusHeading, num, plural, settled } from './dom.js';
import { keptWalk } from './walk.js';
import { streakBlock } from './badges.js';
import { wordPercent } from '../streak.js';
import { duration, untilText } from '../plan.js';
import { formatDay } from '../dates.js';

export const SEGMENTS = [
  ['new', 'New'],
  ['learning', 'Learning'],
  ['perfect', 'Word perfect'],
  ['missed', 'Missed last time'],
];

const range = ({ low, high }) => (low === high ? duration(low) : `${duration(low)} to ${duration(high)}`);

function summaryItems(plan, model) {
  const c = plan.counts;
  const items = [];
  if (c.due) items.push(`${plural(c.due, 'line')} to check`);
  if (plan.runs.length > 3) items.push(`Runs in ${plural(plan.runs.length, 'scene')}: ${plural(c.runItems, 'line')}`);
  else for (const r of plan.runs) items.push(`Run: ${model.scenes[r.scene].heading}, ${plural(r.itemIds.length, 'line')}`);
  if (c.newWords) items.push(`${num(c.newWords)} new words to learn (${plural(c.newItems, 'line')})`);
  return items;
}

export function sceneLabel(sc) {
  return sc.speeches ? `${sc.heading}: ${sc.perfectSpeeches} of ${sc.speeches} speeches word perfect` : `${sc.heading}: on screen text only`;
}

// One bar per scene, segments sized by words. The label says the same in words.
export function mapOf(progress) {
  return [
    h(
      'ul',
      { class: 'legend', 'aria-label': 'Key' },
      SEGMENTS.map(([key, text]) => h('li', {}, h('span', { class: `swatch seg ${key}`, 'aria-hidden': 'true' }), text)),
    ),
    h(
      'ul',
      { class: 'map' },
      progress.scenes.map((sc) =>
        h(
          'li',
          {},
          h('span', { class: 'label' }, sceneLabel(sc)),
          sc.words
            ? h(
                'span',
                { class: 'track', 'aria-hidden': 'true' },
                SEGMENTS.filter(([key]) => sc.seg[key] > 0).map(([key]) => h('span', { class: `seg ${key}`, style: { flexGrow: String(sc.seg[key]) } })),
              )
            : null,
        ),
      ),
    ),
  ];
}

// What Today keeps out of the way with one main button: everything else, a tap away.
export function showMore(ctx) {
  const plan = ctx.plan();
  const entry = (title, what, go) => h('li', {}, button([h('strong', {}, title), h('span', {}, what)], go));
  ctx.root.append(
    screen({
      title: 'More',
      back: () => ctx.go('today'),
      backLabel: 'Today',
      body: [
        h(
          'ul',
          { class: 'scene-list' },
          plan.done ? null : entry('Just 2 minutes', 'When there is no time for more.', () => ctx.go('sprint', { scope: plan.tests.length ? 'tests' : 'all', minutes: 2 })),
          plan.done && plan.ahead.length ? entry('Run through', 'In script order, a scene or the whole play.', () => ctx.go('choose', { run: true })) : null,
          !plan.done ? entry('Run through', 'In script order, a scene or the whole play.', () => ctx.go('choose', { run: true })) : null,
          plan.done && plan.extraRuns.length ? entry('An extra run', 'Another run of a beat that is coming on.', () => ctx.go('sprint', { extra: 'runs' })) : null,
          entry('Choose what to practise', 'A scene, and how much help you want.', () => ctx.go('choose')),
          entry('Scenes', 'Read a scene, or hear it read aloud.', () => ctx.go('scenes')),
          entry('Already know some?', 'Check them, and skip teaching what you know.', () => ctx.go('checkin')),
          ctx.settings.showStreaks ? entry('Badges', 'What you have won, and what is still to win.', () => ctx.go('badges')) : null,
          entry('Settings', 'Dates, audio, text size and everything else.', () => ctx.go('settings')),
        ),
      ],
    }),
  );
}

export function showToday(ctx) {
  async function render() {
    if (ctx.update) return location.reload(); // nothing is under way here
    const nav = ctx.nav;
    await ctx.refreshEvents();
    const kept = await keptWalk(ctx);
    if (ctx.nav !== nav) return;
    ctx.refit();
    const plan = ctx.plan();
    const s = ctx.settings;
    const p = plan.progress;
    const now = Date.now();
    const body = [];

    if (s.showPercent) body.push(h('p', { class: 'percent' }, `${wordPercent(ctx.model.items, ctx.getState)}%`));
    body.push(h('p', { class: 'headline' }, `${num(p.perfectWords)} of ${num(p.totalWords)} words word perfect`));
    if (s.showStreaks) body.push(streakBlock(ctx));
    // What comes next: off script day, then show week.
    const next = plan.day <= s.deadline ? `Off script by ${formatDay(s.deadline, { long: true })}.` : s.showDay && plan.day < s.showDay ? `Show week from ${formatDay(s.showDay, { long: true })}.` : null;
    if (next) body.push(h('p', { class: 'help' }, next));
    for (const note of plan.notes) body.push(h('p', { class: 'message' }, note));
    if (kept) body.push(h('p', { class: 'message' }, 'Your last walk is waiting to be saved.'), button('Save it', settled(() => ctx.go('walk')), { class: 'btn' }));

    if (plan.done) {
      body.push(
        h(
          'div',
          { class: 'done-now', role: 'status' },
          h('p', {}, h('strong', {}, 'All done for now.')),
          plan.nextAt ? h('p', {}, `The next check is ready ${untilText(plan.nextAt, now, plan.day)}.`) : null,
        ),
      );
    } else {
      body.push(h('h2', {}, 'Ready now'), h('ul', { class: 'summary' }, summaryItems(plan, ctx.model).map((t) => h('li', {}, t))));
      const pace = plan.pace.measured ? 'at your pace' : 'at a typical pace';
      body.push(h('p', {}, `The rest of today: about ${range(plan.estimate)} ${pace}.`));
    }
    if (plan.pace.todayMinutes >= 1) body.push(h('p', { class: 'help' }, `Practised today: ${duration(plan.pace.todayMinutes)}.`));
    body.push(h('p', { class: 'help' }, plan.forecast));
    body.push(h('h2', {}, 'The play'), ...mapOf(p));

    const others = h(
      'div',
      { class: 'row' },
      button('Walk', () => ctx.go('walk')),
      button('Scenes', () => ctx.go('scenes')),
      s.showStreaks ? button('Badges', () => ctx.go('badges')) : null,
      button('Settings', () => ctx.go('settings')),
    );
    const choose = button('Choose what to practise', () => ctx.go('choose'));
    // In script order: everything learned so far, every line, the whole play or a scene.
    const runThrough = button('Run through', () => ctx.go('choose', { run: true }));
    let footer;
    if (s.oneButton) {
      const main = !plan.done
        ? button('Start sprint', () => ctx.go('sprint'), { class: 'btn primary' })
        : plan.ahead.length
          ? button('Head start on tomorrow', () => ctx.go('sprint', { extra: 'new' }), { class: 'btn primary' })
          : button('Run through', () => ctx.go('choose', { run: true }), { class: 'btn primary' });
      footer = [main, h('div', { class: 'row' }, button('Walk', () => ctx.go('walk')), button('More', () => ctx.go('more')))];
    } else if (plan.done) {
      footer = [
        plan.ahead.length ? button('Head start on tomorrow', () => ctx.go('sprint', { extra: 'new' }), { class: 'btn primary' }) : null,
        h(
          'div',
          { class: 'row' },
          [plan.extraRuns.length ? button('An extra run', () => ctx.go('sprint', { extra: 'runs' }), { class: plan.ahead.length ? 'btn' : 'btn primary' }) : null, runThrough].filter(Boolean),
        ),
        choose,
        others,
      ].filter(Boolean);
    } else {
      footer = [
        button('Start sprint', () => ctx.go('sprint'), { class: 'btn primary' }),
        h('div', { class: 'row' }, button('Just 2 minutes', () => ctx.go('sprint', { scope: plan.tests.length ? 'tests' : 'all', minutes: 2 })), runThrough),
        choose,
        others,
      ];
    }
    clear(ctx.root).append(screen({ title: 'Today', body, footer, className: 'today' }));
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') render().then(() => focusHeading(ctx.root));
  };
  const onUpdate = () => render();
  document.addEventListener('visibilitychange', onVisible);
  document.addEventListener('offscript:update', onUpdate);
  return render().then(() => () => {
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('offscript:update', onUpdate);
  });
}
