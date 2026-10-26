// Scenes: the play scene by scene, and a reader for each: speech numbers, speakers in bold,
// directions in square brackets (never italics), on screen text marked as such.
import { h, screen, button, announce, num, plural } from './dom.js';
import { progressOf } from '../plan.js';
import { bracketParens } from '../items.js';
import { canSpeak, speak, stopSpeaking } from '../tts.js';

export function showScenes(ctx) {
  const progress = progressOf(ctx.model, ctx.index, ctx.getState);
  const focus = ctx.settings.focusScene;
  ctx.root.append(
    screen({
      title: 'Scenes',
      back: () => ctx.go('today'),
      body: [
        h(
          'ul',
          { class: 'scene-list' },
          progress.scenes.map((sc) =>
            h(
              'li',
              {},
              button(
                [
                  h('strong', {}, sc.heading),
                  h('span', {}, sc.speeches ? `${sc.perfectSpeeches} of ${sc.speeches} speeches word perfect, ${plural(sc.words, 'word')}` : 'On screen text only'),
                  focus === sc.scene ? h('span', {}, 'Learning this scene next') : null,
                ],
                () => ctx.go('reader', { scene: sc.scene }),
              ),
            ),
          ),
        ),
      ],
    }),
  );
}

// Each part of the scene as the reader shows it, and what read aloud says for it (null: skipped).
function parts(scene) {
  return scene.reader.map((ev) => {
    if (ev.t === 'speech') {
      return {
        el: h('p', { class: 'speech' }, h('span', { class: 'n' }, String(ev.n)), h('strong', {}, ev.speaker), ' ', bracketParens(ev.text)),
        say: ev.itemIds.length ? `${ev.speaker}. ${ev.text}` : null,
      };
    }
    if (ev.t === 'screen') return { el: h('p', { class: 'on-screen' }, `[On screen] `, h('strong', {}, ev.speaker), ' ', ev.text), say: null };
    if (ev.t === 'placard') return { el: h('p', { class: 'dir' }, `[Placard: ${ev.text}]`), say: null };
    return { el: h('p', { class: 'dir' }, `[${ev.text}]`), say: null };
  });
}

export function showReader(ctx, { scene: index }) {
  const scene = ctx.model.scenes[index];
  const all = parts(scene);
  let reading = false;

  const readBtn = canSpeak()
    ? button('Read aloud', async () => {
        if (reading) return stopReading();
        reading = true;
        readBtn.textContent = 'Stop reading';
        for (const p of all) {
          if (!reading) break;
          if (!p.say) continue;
          p.el.classList.add('playing');
          p.el.scrollIntoView({ block: 'center' });
          await speak(p.say, { voiceURI: ctx.settings.voiceURI, rate: ctx.settings.rate });
          p.el.classList.remove('playing');
        }
        stopReading();
      })
    : null;
  function stopReading() {
    reading = false;
    stopSpeaking();
    for (const p of all) p.el.classList.remove('playing');
    if (readBtn) readBtn.textContent = 'Read aloud';
  }

  const learned = scene.itemIds.some((id) => ctx.getState(id).status !== 'new');
  const allLearned = scene.itemIds.every((id) => ctx.getState(id).status === 'review');
  const focusBtn = allLearned
    ? null
    : button(
        'Learn this scene next',
        async () => {
          const on = ctx.settings.focusScene !== index;
          await ctx.saveSettings({ focusScene: on ? index : null });
          focusBtn.setAttribute('aria-pressed', String(on));
          announce(on ? `${scene.heading} comes next in new lines` : 'Back to running order');
        },
        { pressed: String(ctx.settings.focusScene === index) },
      );

  const footer = scene.itemIds.length
    ? [
        button(learned ? 'Run this scene' : 'Try a run of this scene', () => ctx.go('sprint', { custom: { scene: index, itemIds: [...scene.itemIds] } }), { class: 'btn primary' }),
        h('div', { class: 'row' }, [focusBtn, readBtn].filter(Boolean)),
      ]
    : [];

  ctx.root.append(
    screen({
      title: scene.heading,
      back: () => ctx.go('scenes'),
      body: [
        h('p', { class: 'help' }, scene.words ? `${plural(scene.reader.filter((r) => r.t === 'speech').length, 'speech', 'speeches')}, ${num(scene.words)} words.` : 'On screen text only.'),
        h('div', { class: 'reader' }, all.map((p) => p.el)),
        learned
          ? h(
              'div',
              { class: 'stack' },
              h('p', { class: 'help' }, 'Its lines go back to not started, to learn them again from the beginning.'),
              button('Start this scene again', () => ctx.go('again', { scene: index })),
            )
          : null,
      ],
      footer,
    }),
  );
  return () => stopReading();
}
