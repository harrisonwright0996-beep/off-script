// Start again from 0%: every line, or one scene's, back to not started, to relearn from the beginning.
// Asked first, with a backup offered. The script, the audio pack and the settings stay.
import { h, screen, button, announce } from './dom.js';
import { saveBackup } from './settings.js';

// scene: a scene's index, or null for the whole play.
export function showStartAgain(ctx, { scene = null } = {}) {
  const one = scene === null ? null : ctx.model.scenes[scene];
  const back = () => (one ? ctx.go('reader', { scene }) : ctx.go('settings'));
  const name = one ? 'Start this scene again' : 'Start again from 0%';
  const lead = one
    ? `Every line of ${one.heading} goes back to not started, and its answers so far are cleared. Every other scene keeps its progress.`
    : 'Every line goes back to not started, and your answers so far are cleared. The script, the audio pack, your dates and your settings stay.';

  async function startAgain() {
    await ctx.startAgain(one ? [...one.itemIds] : null);
    announce(one ? `${one.heading}: every line is back to not started.` : 'Every line is back to not started.');
    ctx.go(one ? 'reader' : 'today', one ? { scene } : {});
  }

  ctx.root.append(
    screen({
      title: `${name}?`,
      back,
      body: [h('p', { class: 'lead' }, lead), h('p', {}, 'Any sprint or practice part way is dropped. Back up your progress first if you might want it again.')],
      footer: [
        button(one ? 'Keep its progress' : 'Keep my progress', back, { class: 'btn primary' }),
        button('Back up first', () => saveBackup(ctx)),
        button(name, startAgain),
      ],
    }),
  );
}
