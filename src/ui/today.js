// Today: what the plan holds right now, how far the play has come, and one obvious next action.
// Worked out afresh whenever the screen opens or the phone comes back to it.
import { h, clear, screen, button, focusHeading, num, plural } from './dom.js';
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

export function showToday(ctx) {
  async function render() {
    await ctx.refreshEvents();
    const plan = ctx.plan();
    const s = ctx.settings;
    const p = plan.progress;
    const now = Date.now();
    const body = [];

    if (ctx.update) {
      body.push(h('div', { class: 'notice' }, h('p', {}, 'A new version is ready.'), button('Update now', () => ctx.applyUpdate(), { class: 'btn' })));
    }
    body.push(h('p', { class: 'headline' }, `${num(p.perfectWords)} of ${num(p.totalWords)} words word perfect`));
    // What comes next: off script day, then show week.
    const next = plan.day <= s.deadline ? `Off script by ${formatDay(s.deadline, { long: true })}.` : s.showDay && plan.day < s.showDay ? `Show week from ${formatDay(s.showDay, { long: true })}.` : null;
    if (next) body.push(h('p', { class: 'help' }, next));
    for (const note of plan.notes) body.push(h('p', { class: 'message' }, note));

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
      button('Settings', () => ctx.go('settings')),
    );
    const choose = button('Choose what to practise', () => ctx.go('choose'));
    // In script order: everything learned so far, every line, the whole play or a scene.
    const runThrough = button('Run through', () => ctx.go('choose', { run: true }));
    let footer;
    if (plan.done) {
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
