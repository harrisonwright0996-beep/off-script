// Short notes on why this works, in plain words. One shows after each sprint, a different one each time.
export const SCIENCE = [
  'Trying to remember is what makes a line stick. Reading it again feels easier and does much less.',
  'Hard does not mean it is going badly. Digging for a line, then checking it, helps it stick.',
  'Forgetting a bit is good. Bringing a line back just as it starts to fade makes it last much longer.',
  'Several sprints spread across the day beat one long cram. Sleep seems to help lines settle too.',
  'Getting a line wrong is part of learning it. Seeing the right words straight after fixes it.',
  'Saying a line aloud helps it stick better than going over it in your head.',
  'Lines come back out of order so that you learn them from the cue, not from your last line. On stage, the cue is all you get.',
  'Walks help because you say your lines from memory, with no script to peek at. Moving in ways that fit the words helps too.',
  'Knowing a line now does not mean you will still know it later. Memories fade unless you use them.',
];

export const scienceNote = (n) => SCIENCE[n % SCIENCE.length];
