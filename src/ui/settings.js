// Settings: how it looks, how practice works, the voice, the dates, and the script, audio pack and
// progress files. Every change is saved at once.
import { h, clear, screen, button, announce, focusHeading, num, plural } from './dom.js';
import { pickFile } from './setup.js';
import { readAudioPack, packFit } from '../audiopack.js';
import { makeBackup, readBackup } from '../backup.js';
import { withDefaults } from '../settings.js';
import { dayKey, formatDay } from '../dates.js';
import { canSpeak, voices, onVoicesChanged, speak } from '../tts.js';

const OPTIONS = {
  textSize: [90, 100, 115, 130, 150, 175, 200].map((n) => [n, `${n}%`]),
  lineSpacing: [[1.5, 'Normal'], [1.8, 'More'], [2, 'Most']],
  letterSpacing: [['normal', 'Normal'], ['wide', 'Wide'], ['wider', 'Extra wide']],
  theme: [['cream', 'Cream'], ['light', 'Light'], ['dark', 'Dark'], ['auto', 'Match the phone']],
  mode: [['type', 'Type: first letters on the keypad'], ['say', 'Say: aloud, then tap any misses']],
  sprintMinutes: [[12, '12 minutes'], [20, '20 minutes'], [25, '25 minutes']],
  breakMinutes: [[3, '3 minutes'], [5, '5 minutes']],
  walkGap: [['shorter', 'Shorter'], ['normal', 'Normal'], ['longer', 'Longer']],
  rate: [[0.8, 'Slower'], [0.9, 'A little slower'], [1, 'Normal'], [1.1, 'A little faster'], [1.2, 'Faster']],
};

const PACK_PROBLEMS = {
  'not-zip': 'That file is not an audio pack. Choose the zip made on the laptop.',
  'bad-zip': 'That audio pack looks damaged. Try copying it again.',
  'no-manifest': 'That zip is not an Off Script audio pack.',
  'bad-manifest': 'That audio pack is from a different version of the tool. Make a new one on the laptop.',
  'bad-clip': 'Some audio in that pack is damaged. Make a new one on the laptop.',
};

const BACKUP_PROBLEMS = {
  'not-json': 'That file is not an Off Script backup.',
  'not-backup': 'That file is not an Off Script backup.',
  newer: 'That backup is from a newer version of Off Script. Update the app first.',
};

const when = (ms) => {
  const d = new Date(ms);
  return `${formatDay(dayKey(d))} at ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

export function showSettings(ctx) {
  const s = ctx.settings;
  const save = async (patch) => {
    await ctx.saveSettings(patch);
    announce('Saved');
  };

  function select(key, label, options, help) {
    const id = `set-${key}`;
    return h(
      'div',
      { class: 'field' },
      h('label', { for: id }, label),
      h(
        'select',
        { id, onChange: (e) => save({ [key]: options[e.target.selectedIndex][0] }) },
        options.map(([v, text]) => h('option', { value: String(v), selected: String(s[key]) === String(v) }, text)),
      ),
      help ? h('p', { class: 'help' }, help) : null,
    );
  }

  function check(key, label) {
    const id = `set-${key}`;
    return h('label', { class: 'check', for: id }, h('input', { id, type: 'checkbox', checked: !!s[key], onChange: (e) => save({ [key]: e.target.checked }) }), label);
  }

  function date(key, label, help) {
    const id = `set-${key}`;
    return h(
      'div',
      { class: 'field' },
      h('label', { for: id }, label),
      h('input', { id, type: 'date', value: s[key], onChange: (e) => e.target.value && save({ [key]: e.target.value }) }),
      help ? h('p', { class: 'help' }, help) : null,
    );
  }

  function voiceField() {
    if (!canSpeak()) return h('p', { class: 'help' }, 'This phone cannot read aloud here.');
    const box = h('div', {});
    const draw = () => {
      const list = [['', 'The phone’s usual voice'], ...voices().map((v) => [v.voiceURI, `${v.name} (${v.lang})`])];
      clear(box).append(select('voiceURI', 'Voice for reading aloud', list.map(([v, t]) => [v || null, t])));
    };
    draw();
    onVoicesChanged(draw);
    return [box, select('rate', 'Reading speed', OPTIONS.rate), h('div', { class: 'stack' }, button('Try the voice', () => speak('This is how lines will sound when they are read aloud.', { voiceURI: s.voiceURI, rate: s.rate })))];
  }

  // The script and audio pack.
  const meta = h('p', { class: 'help' });
  ctx.store.get('scriptMeta').then((m) => {
    const t = ctx.model.totals;
    meta.textContent = `${plural(ctx.model.scenes.length, 'scene')}, ${num(t.words)} words${m ? `, imported ${when(m.importedAt)}` : ''}.`;
  });
  const packStatus = h('p', { class: 'help', role: 'status' });
  const drawPack = () => {
    if (!ctx.manifest) {
      packStatus.textContent = 'No audio pack yet. Walk uses the phone’s own voice, with the screen on, until there is one.';
      return;
    }
    const fit = packFit(ctx.manifest, ctx.model);
    const total = fit.have + fit.missing;
    packStatus.textContent = fit.missing
      ? `Audio pack: ${num(fit.have)} of ${num(total)} lines have audio. Walk skips the rest. Make a new pack on the laptop to cover them.`
      : `Audio pack: every line has audio${ctx.manifest.importedAt ? `, imported ${when(ctx.manifest.importedAt)}` : ''}.`;
  };
  drawPack();

  async function importPack(accept) {
    const file = await pickFile(accept);
    if (!file) return;
    packStatus.textContent = 'Reading the audio pack. This can take a minute.';
    try {
      const { manifest, clips } = readAudioPack(new Uint8Array(await file.arrayBuffer()));
      await ctx.store.clearAudio();
      await ctx.store.putClips(clips);
      manifest.importedAt = Date.now();
      await ctx.store.set('manifest', manifest);
      ctx.manifest = manifest;
      drawPack();
      announce(packStatus.textContent);
    } catch (err) {
      packStatus.textContent = PACK_PROBLEMS[err.code] || 'The audio pack could not be saved. The phone may be short of space.';
      announce(packStatus.textContent);
    }
  }

  // Progress.
  async function backup() {
    const events = await ctx.store.allEvents();
    const data = makeBackup({ model: ctx.model, states: ctx.states.values(), events, settings: ctx.settings });
    const name = `Off Script progress ${formatDay(dayKey())}.json`;
    const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Off Script progress' });
        announce('Backup ready');
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(file);
    const a = h('a', { href: url, download: name, class: 'visually-hidden' }, 'Download');
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    announce('Backup saved');
  }

  function page(title, body, footer) {
    clear(ctx.root).append(screen({ title, back: () => ctx.go('settings'), body, footer }));
    focusHeading(ctx.root);
  }

  async function restore() {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    let b;
    try {
      b = readBackup(await file.text(), ctx.model);
    } catch (err) {
      return page('That did not work', [h('p', { class: 'lead' }, BACKUP_PROBLEMS[err.code] || BACKUP_PROBLEMS['not-backup'])], [
        button('Back to Settings', () => ctx.go('settings'), { class: 'btn primary' }),
      ]);
    }
    page(
      'Restore this backup?',
      [
        h('p', { class: 'lead' }, `Backup from ${when(b.made)}: progress for ${plural(b.kept, 'line')}.`),
        b.dropped ? h('p', {}, `${plural(b.dropped, 'line')} in the backup are not in this script, so they are left out.`) : null,
        h('p', {}, 'It replaces the progress on this phone.'),
      ],
      [
        button('Restore', async () => {
          await ctx.store.clearStates();
          await ctx.store.putStates(b.states);
          await ctx.store.clearEvents();
          await ctx.store.putEvents(b.events);
          await ctx.store.del('sprint');
          if (b.settings) await ctx.saveSettings(withDefaults(b.settings));
          ctx.states = new Map(b.states.map((st) => [st.id, st]));
          ctx.eventsFrom = null;
          announce('Backup restored');
          ctx.go('today');
        }, { class: 'btn primary' }),
        button('Keep what is here', () => ctx.go('settings')),
      ],
    );
  }

  function removeAll() {
    page(
      'Remove everything?',
      [
        h('p', { class: 'lead' }, 'This deletes the script, your progress and the audio pack from this phone.'),
        h('p', {}, 'Back up your progress first if you might want it again.'),
      ],
      [
        button('Keep everything', () => ctx.go('settings'), { class: 'btn primary' }),
        button('Remove everything', async () => {
          await ctx.store.removeEverything();
          try {
            localStorage.clear();
          } catch {
            // nothing stored there
          }
          location.reload();
        }),
      ],
    );
  }

  const order = s.lastNewDay < s.deadline ? null : 'The last day for new lines should be before off script day.';

  ctx.root.append(
    screen({
      title: 'Settings',
      back: () => ctx.go('today'),
      body: [
        h('h2', {}, 'Look'),
        h(
          'div',
          { class: 'group' },
          select('textSize', 'Text size', OPTIONS.textSize, 'On top of the iPhone’s own Text Size.'),
          select('lineSpacing', 'Line spacing', OPTIONS.lineSpacing),
          select('letterSpacing', 'Letter spacing', OPTIONS.letterSpacing),
          select('theme', 'Colours', OPTIONS.theme),
        ),
        h('h2', {}, 'Practice'),
        h(
          'div',
          { class: 'group' },
          select('mode', 'Answer by', OPTIONS.mode),
          check('askSpeaker', 'Ask who speaks next'),
          check('autoAdvance', 'Move on by itself after a word perfect answer'),
          select('sprintMinutes', 'Sprint length', OPTIONS.sprintMinutes),
          select('breakMinutes', 'Break length', OPTIONS.breakMinutes),
        ),
        h('h2', {}, 'Reading aloud and Walk'),
        h('div', { class: 'group' }, voiceField(), select('walkGap', 'Time to say each line on a walk', OPTIONS.walkGap)),
        h('h2', {}, 'Dates'),
        h(
          'div',
          { class: 'group' },
          date('deadline', 'Off script day'),
          date('lastNewDay', 'Last day for new lines', order || 'After this day it is all runs, so everything is solid for off script day.'),
          date('showDay', 'Show week starts'),
        ),
        h('h2', {}, 'Script and audio'),
        h(
          'div',
          { class: 'group' },
          meta,
          h('div', { class: 'stack' }, button('Import the script again', () => ctx.go('setup', { reimport: true }))),
          packStatus,
          h(
            'div',
            { class: 'stack' },
            button('Import audio pack', () => importPack('.zip,application/zip')),
            button('Zip file greyed out? Try this', () => importPack(''), { class: 'btn link' }),
          ),
        ),
        h('h2', {}, 'Your progress'),
        h(
          'div',
          { class: 'group' },
          h('p', { class: 'help' }, 'A backup holds your results, never the script’s words. Save it to Files.'),
          h('div', { class: 'stack' }, button('Back up progress', backup), button('Restore a backup', restore), button('Remove everything', removeAll)),
        ),
        h('p', { class: 'help' }, 'Off Script keeps everything on this phone. Nothing is sent anywhere.'),
      ],
    }),
  );
}
