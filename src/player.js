// Plays a walk tape in one <audio> element, which carries on with the screen locked in an
// installed app. Earbud controls: next track marks a miss, previous track replays the line.
import { concatBytes } from './mp3.js';

export function tapeBlob(steps, clips, silence) {
  const parts = [];
  for (const s of steps) {
    if (s.clip) {
      const bytes = clips.get(s.clip);
      if (bytes) parts.push(bytes);
    } else {
      for (let i = 0; i < s.silence; i++) parts.push(silence);
    }
  }
  return new Blob([concatBytes(parts)], { type: 'audio/mpeg' });
}

export function createPlayer({ onMark, onReplay, onTime, onEnded, onError }) {
  const audio = new Audio();
  audio.preload = 'auto';
  let url = null;
  const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;

  const handlers = {
    play: () => audio.play(),
    pause: () => audio.pause(),
    nexttrack: () => onMark && onMark(audio.currentTime),
    previoustrack: () => onReplay && onReplay(audio.currentTime),
  };
  if (ms) {
    for (const [action, fn] of Object.entries(handlers)) {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        // not supported on this device
      }
    }
  }
  audio.addEventListener('timeupdate', () => onTime && onTime(audio.currentTime));
  audio.addEventListener('ended', () => onEnded && onEnded());
  audio.addEventListener('error', () => onError && onError(audio.error));
  audio.addEventListener('play', () => ms && (ms.playbackState = 'playing'));
  audio.addEventListener('pause', () => ms && (ms.playbackState = 'paused'));

  return {
    audio,
    load(blob, { title, artist }) {
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(blob);
      audio.src = url;
      this.setInfo(title, artist);
    },
    setInfo(title, artist) {
      if (ms && typeof MediaMetadata !== 'undefined') {
        ms.metadata = new MediaMetadata({ title, artist, album: 'Off Script' });
      }
    },
    play: () => audio.play(),
    pause: () => audio.pause(),
    seek(t) {
      audio.currentTime = Math.max(0, t);
    },
    get time() {
      return audio.currentTime;
    },
    get paused() {
      return audio.paused;
    },
    destroy() {
      audio.pause();
      if (ms) for (const action of Object.keys(handlers)) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          // ignore
        }
      }
      if (url) URL.revokeObjectURL(url);
      audio.removeAttribute('src');
      audio.load();
    },
  };
}

// Keeps the screen on for the walk without an audio pack. Returns a release function.
export async function keepScreenOn() {
  try {
    if (navigator.wakeLock) {
      const lock = await navigator.wakeLock.request('screen');
      return () => lock.release().catch(() => {});
    }
  } catch {
    // refused (low power mode, for example)
  }
  return () => {};
}
