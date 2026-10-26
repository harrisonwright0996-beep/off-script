// Read aloud with the phone's own voices (speech synthesis runs on the phone).
// On iPhone it must start from a tap, and it stops when the screen locks.

export const canSpeak = () => typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';

let cached = [];
export function voices() {
  if (!canSpeak()) return [];
  const all = speechSynthesis.getVoices();
  if (all.length) cached = all;
  const english = cached.filter((v) => /^en[-_]/i.test(v.lang));
  const rank = (v) => (/^en[-_]GB/i.test(v.lang) ? 0 : /^en[-_](IE|AU|NZ)/i.test(v.lang) ? 1 : 2);
  return english.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function onVoicesChanged(fn) {
  if (canSpeak()) speechSynthesis.addEventListener('voiceschanged', fn);
}

// Text as it should be heard: no bracketed directions, capitals read as words.
export function speakable(text) {
  return text
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b[A-Z]{2,}\b/g, (w) => w.toLowerCase())
    .replace(/^…/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function speak(text, { voiceURI = null, rate = 1 } = {}) {
  if (!canSpeak()) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(speakable(text));
    const v = voices().find((x) => x.voiceURI === voiceURI) || voices()[0];
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else u.lang = 'en-GB';
    u.rate = rate;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (canSpeak()) speechSynthesis.cancel();
}
