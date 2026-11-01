// Hear the cue on a card: the clips a walk plays for this line, or the phone's voice if the pack has
// none. The clips are read as the card is drawn, because a phone only plays sound from the tap itself.
import { button } from './dom.js';
import { cueClips } from '../tape.js';
import { concatBytes } from '../mp3.js';
import { canSpeak, speak, stopSpeaking } from '../tts.js';

let playing = null;

export function stopCue() {
  if (playing) {
    playing.pause();
    URL.revokeObjectURL(playing.src);
  }
  playing = null;
  stopSpeaking();
}

async function cueBlob(ctx, item) {
  const refs = ctx.manifest ? cueClips(item, ctx.index, ctx.manifest) : [];
  if (!refs.length) return null;
  const clips = await ctx.store.getClips(refs.map((r) => r.file));
  const parts = refs.map((r) => clips.get(r.file));
  if (parts.some((p) => !p)) return null;
  return new Blob([concatBytes(parts)], { type: 'audio/mpeg' });
}

export function hearCue(ctx, item, cue) {
  stopCue(); // a new card: the last cue stops, and nothing plays over the next one
  const words = (cue.lines || [cue]).map((l) => l.text).join(' ');
  let blob = null;
  cueBlob(ctx, item).then((b) => (blob = b)).catch(() => {});
  const hear = () => {
    stopCue();
    if (blob) {
      playing = new Audio(URL.createObjectURL(blob));
      playing.play().catch(() => {});
    } else if (canSpeak()) speak(words, { voiceURI: ctx.settings.voiceURI, rate: ctx.settings.rate });
  };
  return button('Hear the cue', hear, { class: 'btn link hear-cue' });
}
