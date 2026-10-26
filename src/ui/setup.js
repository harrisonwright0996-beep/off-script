// Welcome, import the script from Files (OneDrive), check the summary, check the dates.
// Also used to import a revised script later: progress is kept for every unchanged line.
import { h, screen, button, clear, announce, num, plural } from './dom.js';
import { readDocxParagraphs, DocxError } from '../docx.js';
import { parseScript } from '../parse.js';
import { buildModel } from '../items.js';
import { askToPersist } from '../store.js';
import { formatDay } from '../dates.js';

const DOCX = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// Opens the Files picker. Must be called from a tap.
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: accept || undefined, class: 'visually-hidden', 'aria-hidden': 'true', tabindex: '-1' });
    input.addEventListener('change', () => {
      resolve(input.files && input.files[0] ? input.files[0] : null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve(null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

const PROBLEMS = {
  'not-zip': 'That file is not a Word document. Choose the .docx script.',
  'bad-zip': 'That file looks damaged. Try saving it again in Word, or choose another copy.',
  'no-document': 'That file is not a Word document. Choose the .docx script.',
  'no-scenes': 'No scenes found. The script needs headings like PROLOGUE or SCENE 1: TITLE.',
};

export async function readScriptFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const model = buildModel(parseScript(readDocxParagraphs(bytes)));
  if (!model.items.length) throw new DocxError('no-scenes');
  return model;
}

// Compares a new model with the one on the phone, by stable ids.
export function compareModels(oldModel, newModel) {
  const oldIds = new Set(oldModel.items.map((i) => i.id));
  const newIds = new Set(newModel.items.map((i) => i.id));
  const slot = (i) => `${i.scene}.${i.n}.${i.part}`;
  const oldSlots = new Set(oldModel.items.filter((i) => !newIds.has(i.id)).map(slot));
  const added = newModel.items.filter((i) => !oldIds.has(i.id));
  const changed = added.filter((i) => oldSlots.has(slot(i))).length;
  return {
    unchanged: newModel.items.length - added.length,
    changed,
    added: added.length - changed,
    removed: oldModel.items.filter((i) => !newIds.has(i.id)).length - changed,
  };
}

export function showSetup(ctx, { step = 'welcome', reimport = false } = {}) {
  const root = ctx.root;
  const show = (el) => {
    clear(root).append(el);
    const h1 = root.querySelector('h1');
    if (h1) h1.focus({ preventScroll: true });
  };

  async function choose(accept = DOCX) {
    const file = await pickFile(accept);
    if (!file) return;
    try {
      const model = await readScriptFile(file);
      summary(model, file.name);
    } catch (err) {
      problem(PROBLEMS[err.code] || PROBLEMS['not-zip']);
    }
  }

  function welcome() {
    show(
      screen({
        title: 'Off Script',
        body: [
          h('p', { class: 'lead' }, 'Learn the whole play, word for word and cue by cue.'),
          h('p', {}, 'Your script stays on this phone. Nothing is sent anywhere.'),
          h('p', {}, 'Each day is planned for you. Just press Start sprint.'),
        ],
        footer: [button('Choose the script', () => choose(), { class: 'btn primary' })],
      }),
    );
  }

  function problem(text) {
    show(
      screen({
        title: 'That did not work',
        back: reimport ? () => ctx.go('settings') : null,
        body: [h('p', { class: 'lead' }, text)],
        footer: [
          button('Choose another file', () => choose(), { class: 'btn primary' }),
          button('File greyed out? Try this', () => choose(''), { class: 'btn link' }),
        ],
      }),
    );
  }

  function summary(model, fileName) {
    const t = model.totals;
    const diff = reimport && ctx.model ? compareModels(ctx.model, model) : null;
    const scenes = model.scenes.map((sc) =>
      h('li', {}, h('strong', {}, sc.heading), ' ', sc.words ? plural(sc.words, 'word') : 'on screen text only'),
    );
    show(
      screen({
        title: 'Is this the script?',
        back: reimport ? () => ctx.go('settings') : null,
        body: [
          h('p', { class: 'lead' }, `${plural(model.scenes.length, 'scene')}, ${plural(t.speeches, 'speech', 'speeches')}, ${num(t.words)} words to learn.`),
          diff
            ? h('p', {}, `${num(diff.unchanged)} lines unchanged and keep their progress. ${num(diff.changed)} changed, ${num(diff.added)} new, ${num(diff.removed)} removed.`)
            : h('p', {}, 'Does that look right?'),
          h('ul', { class: 'plain' }, scenes),
        ],
        footer: [
          button(reimport ? 'Use this version' : 'Yes, use this script', () => accept(model, fileName), { class: 'btn primary' }),
          button('Choose another file', () => choose(), { class: 'btn' }),
        ],
      }),
    );
  }

  async function accept(model, fileName) {
    await ctx.setModel(model, { fileName, importedAt: Date.now() });
    const persisted = await askToPersist();
    if (reimport) {
      announce('Script updated');
      return ctx.go('today');
    }
    dates(persisted);
  }

  function dates(persisted) {
    const s = ctx.settings;
    const field = (key, label, help) => {
      const id = `date-${key}`;
      return h(
        'div',
        { class: 'field' },
        h('label', { for: id }, label),
        h('input', { id, type: 'date', value: s[key], onChange: (e) => e.target.value && ctx.saveSettings({ [key]: e.target.value }) }),
        help ? h('p', { class: 'help' }, help) : null,
      );
    };
    show(
      screen({
        title: 'Your dates',
        body: [
          h('p', { class: 'lead' }, `Off script by ${formatDay(s.deadline, { long: true })}.`),
          field('deadline', 'Off script day'),
          field('lastNewDay', 'Last day for new lines', 'After this day it is all runs, so everything is solid for off script day.'),
          field('showDay', 'Show week starts'),
          persisted ? null : h('p', { class: 'help' }, 'Tip: back up your progress now and then from Settings.'),
        ],
        footer: [button('Looks right', () => ctx.go('today'), { class: 'btn primary' })],
      }),
    );
  }

  if (step === 'import' || reimport) {
    show(
      screen({
        title: reimport ? 'Import the script again' : 'Import the script',
        back: reimport ? () => ctx.go('settings') : null,
        body: [h('p', { class: 'lead' }, 'Choose the .docx script from Files. Progress is kept for every line that has not changed.')],
        footer: [
          button('Choose the script', () => choose(), { class: 'btn primary' }),
          button('File greyed out? Try this', () => choose(''), { class: 'btn link' }),
        ],
      }),
    );
  } else welcome();
}
