// Settings and their defaults. Dates are Harrison's production dates; all can be changed in Settings.
export const DEFAULT_SETTINGS = {
  deadline: '2026-11-04', // off script day
  lastNewDay: '2026-11-01', // last day for new lines
  showDay: '2026-12-14', // show week starts
  mode: 'type', // 'type' or 'say'
  askSpeaker: true, // the "who's next" step
  sprintMinutes: 12,
  breakMinutes: 3,
  autoAdvance: false,
  closeLines: true, // one word out of a long line already learned still passes
  scienceNotes: true, // a note on why it works after a sprint
  textSize: 100, // percent, 90 to 200
  lineSpacing: 1.5, // 1.5, 1.8 or 2
  letterSpacing: 'normal', // 'normal', 'wide' or 'wider'
  theme: 'cream', // 'cream', 'light', 'dark' or 'auto'
  walkGap: 'normal', // 'shorter', 'normal' or 'longer'
  walkCoach: true, // the spoken coach on walks
  walkDirections: true, // stage directions read on walks
  showPercent: true, // the % on Today
  showStreaks: true, // streaks and badges
  oneButton: true, // Today has one main button, with the rest under More
  voiceURI: null,
  rate: 1,
  focusScene: null, // "Learn this scene next"
  practice: null, // the last choices on Choose what to practise: { scene, which, help }
  runThrough: null, // the last choices on Run through: { scene, which, help }
};

export function withDefaults(saved) {
  return { ...DEFAULT_SETTINGS, ...(saved || {}) };
}
