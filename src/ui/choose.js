// Choose what to practise: where (the whole play or one scene), which lines (still being learned,
// everything learned so far, or every line) and how much help. Run through (run): the same screen for
// a run in script order of everything learned so far or every line. Either runs as a sprint of its
// own, saved apart from the day's sprint (sprint.js), so a practice stopped part way can carry on.
// His last choices are remembered, for each apart.
import { h, screen, button, announce, plural } from './dom.js';
import { practiceLines, practiceTitle, practiceMinutes } from '../practice.js';
import { linesLeft } from '../session.js';
import { duration } from '../plan.js';
import { PRACTICE } from './sprint.js';

const WHICH = [
  ['learning', 'Lines still being learned', 'Started, but not yet secure: not yet right on three separate days, or missed last time.'],
  ['learned', 'Everything learned so far', 'Every line learned so far, as a full check.'],
  ['all', 'Every line', 'Every line, started or not.'],
];
const RUN_WHICH = WHICH.filter(([v]) => v !== 'learning');
const HELP = [
  ['auto', 'Let Off Script choose', 'A line not yet known is taught step by step. After that, the first letters first while it is new, after a miss, or when your forgetting curve says you may need them.'],
  ['cue', 'From the cue first', 'Every line from its cue alone first; a miss comes back with the first letters, then without.'],
  ['none', 'No help', 'Every line from the cue alone, misses too.'],
  ['letters', 'First letters first', 'Every line with the first letters, then later without.'],
  ['read', 'Read it first', 'Read each line, say it from the first letters, then later without.'],
];

export async function showChoose(ctx, { run = false } = {}) {
  const model = ctx.model;
  const which = run ? RUN_WHICH : WHICH;
  const where = [[null, 'The whole play'], ...model.scenes.filter((sc) => sc.itemIds.length).map((sc) => [sc.index, sc.heading])];
  const last = (run ? ctx.settings.runThrough : ctx.settings.practice) || {};
  const known = (options, v, fallback) => (options.some(([o]) => o === v) ? v : fallback);
  // A run through goes from the cue first, as on the night; help only after a miss.
  const pick = { scene: known(where, last.scene, null), which: known(which, last.which, which[0][0]), help: known(HELP, last.help, run ? 'cue' : 'auto') };

  const saved = await ctx.store.get(PRACTICE);
  const left = saved && saved.day === ctx.today() && saved.hash === model.hash ? linesLeft(saved.state) : 0;
  const carryOn = left
    ? h(
        'div',
        { class: 'notice' },
        h('p', {}, h('strong', {}, 'Part way through: '), `${saved.state.custom.title}. ${plural(left, 'line')} still to go.`),
        button('Carry on', () => ctx.go('sprint', { practice: 'resume' }), { class: 'btn' }),
      )
    : null;

  const { pace } = ctx.plan();
  const summary = h('p', { class: 'lead' });
  const begin = button('Start', start, { class: 'btn primary' });
  const lines = () => practiceLines({ model, getState: ctx.getState, scene: pick.scene, which: pick.which });

  // A choice: its list, and a line under it saying what the choice means.
  function field(key, label, options) {
    const id = `choose-${key}`;
    const note = h('p', { class: 'help', id: `${id}-note` });
    const describe = () => {
      note.textContent = (options.find(([v]) => v === pick[key]) || [])[2] || '';
    };
    const list = h(
      'select',
      {
        id,
        'aria-describedby': options[0][2] ? note.id : null,
        onChange: (e) => {
          pick[key] = options[e.target.selectedIndex][0];
          describe();
          update(true);
        },
      },
      options.map(([v, text]) => h('option', { value: String(v), selected: v === pick[key] }, text)),
    );
    describe();
    return h('div', { class: 'field' }, h('label', { for: id }, label), list, options[0][2] ? note : null);
  }

  // How many lines and words that is, and about how long at his pace.
  function update(say = false) {
    const ids = lines();
    const words = ids.reduce((n, id) => n + ctx.index.byId.get(id).words, 0);
    const mins = practiceMinutes({ index: ctx.index, getState: ctx.getState, itemIds: ids, help: pick.help, pace, k: ctx.fit.k });
    const about = mins < 2.5 ? 'under 5 minutes' : `about ${duration(mins)}`; // durations go in fives
    summary.textContent = ids.length
      ? `${plural(ids.length, 'line')}, ${plural(words, 'word')}: ${about} ${pace.measured ? 'at your pace' : 'at a typical pace'}.`
      : 'No lines match these choices. Try Every line.';
    begin.disabled = !ids.length;
    if (say) announce(summary.textContent);
  }

  async function start() {
    const itemIds = lines();
    if (!itemIds.length) return;
    await ctx.saveSettings({ [run ? 'runThrough' : 'practice']: { ...pick } });
    ctx.go('sprint', { practice: { ...pick, itemIds, title: practiceTitle({ model, scene: pick.scene, which: pick.which }), run } });
  }

  const intro = run ? h('p', {}, 'In script order, scene by scene. A miss shows the line and carries on; it comes back after that run.') : null;
  const body = [carryOn, intro, field('scene', 'Where', where), field('which', 'Which lines', which), field('help', 'How much help', HELP), summary];
  update();
  ctx.root.append(screen({ title: run ? 'Run through' : 'Choose what to practise', back: () => ctx.go('today'), backLabel: 'Today', body, footer: [begin] }));
}
