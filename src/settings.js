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
  textSize: 100, // percent, 90 to 200
  lineSpacing: 1.5, // 1.5, 1.8 or 2
  letterSpacing: 'normal', // 'normal', 'wide' or 'wider'
  theme: 'cream', // 'cream', 'light', 'dark' or 'auto'
  walkGap: 'normal', // 'shorter', 'normal' or 'longer'
  voiceURI: null,
  rate: 1,
  focusScene: null, // "Learn this scene next"
  practice: null, // the last choices on Choose what to practise: { scene, which, help }
};

export function withDefaults(saved) {
  return { ...DEFAULT_SETTINGS, ...(saved || {}) };
}
