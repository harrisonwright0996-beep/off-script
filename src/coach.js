// What the walk coach says. The same words go in the audio pack (tools/render-audio.mjs) and are read
// aloud by the phone when there is no pack. STEPS: what the screen and the lock screen show.
export const COACH = {
  intro: 'Here is your walk. Say your lines aloud. If you get a line wrong, or you are not sure, double tap your earbud. That brings it back.',
  listen: 'New line. Just listen.',
  sayBack: 'Now you. Say it back.',
  again: 'Once more.',
  turn: 'Your turn. Say your line.',
  turnShort: 'Your turn.',
  here: 'Here it is.',
  run: 'Now run those lines. Say each one when it is your turn.',
  end: 'That is the walk. Look at your phone, and tick any you missed.',
};

// With no audio pack the phone reads the tape, and marking is by the buttons on the screen.
export const COACH_SPEECH = {
  ...COACH,
  intro: 'Here is your walk. Say your lines aloud. If you get a line wrong, or you are not sure, tap Missed. That brings it back.',
  end: 'That is the walk. When you have stopped, look at your phone and tick any you missed.',
};

export const STEPS = {
  listen: 'New line: just listen',
  sayBack: 'Say it back',
  again: 'Listen once more',
  turn: 'Your turn: say your line',
  here: 'Check: did you get it right?',
  run: 'Now run those lines',
  cue: 'Listen for your cue',
  end: 'That is the walk',
};
