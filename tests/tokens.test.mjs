import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyOf, tokenize, keyedCount, firstLettersLine, joinTokens, phraseStarts, lettersShown, blankOf } from '../src/tokens.js';

const keys = (s) => tokenize(s).filter((t) => t.k !== null).map((t) => t.k).join('');

test('keys are first letters or digits, lower case, accents stripped', () => {
  assert.equal(keyOf('I’ve'), 'i');
  assert.equal(keyOf('254'), '2');
  assert.equal(keyOf('£35,'), '3');
  assert.equal(keyOf('café'), 'c');
  assert.equal(keyOf('Élan'), 'e');
  assert.equal(keyOf('İstanbul'), 'i');
  assert.equal(keyOf('“please”'), 'p');
  assert.equal(keyOf('—'), null);
});

test('words split on spaces and on dashes between letters', () => {
  assert.equal(keys('Tickets cost £35, and that’s the well-known price.'), 'tc3attwkp');
  assert.equal(keys('On my way… wait—what?'), 'omwww');
  assert.equal(keys('Na-na-na'), 'nnn');
});

test('parenthetical directions are shown in brackets and never tested', () => {
  const t = tokenize('(Texting.) On my way.');
  assert.deepEqual(t[0], { d: '[Texting.]', a: ' ', k: null });
  assert.equal(keyedCount(t), 3);
});

test('stray punctuation joins the word before it', () => {
  const t = tokenize('Wait - what');
  assert.equal(t.length, 2);
  assert.equal(t[0].d, 'Wait -');
  assert.equal(joinTokens(t), 'Wait - what');
});

test('joining tokens gives the line back', () => {
  for (const s of ['Tickets cost £35, and that’s the well-known price.', 'On my way… wait—what?', 'Say “please” first.']) {
    assert.equal(joinTokens(tokenize(s)), s);
  }
});

test('first letters view keeps capitals and punctuation; numbers stay whole', () => {
  assert.equal(firstLettersLine(tokenize('Tickets cost £35, and that’s the well-known price.')), 'T c £35, a t t w-k p.');
  assert.equal(firstLettersLine(tokenize('Say “please” first.')), 'S “p” f.');
});

test('phrases start at the first word, after a pause mark, a dash between words or a direction', () => {
  const t = tokenize('On my way… wait—what? (Turns.) No, well-known places, I said.');
  assert.deepEqual(t.map((x) => x.d), ['On', 'my', 'way…', 'wait', 'what?', '[Turns.]', 'No,', 'well', 'known', 'places,', 'I', 'said.']);
  assert.deepEqual([...phraseStarts(t)], [0, 3, 4, 6, 7, 10], 'not after the hyphen in well-known');
  assert.deepEqual([...phraseStarts(tokenize('Wait - what now'))], [0, 1], 'a spaced dash is a pause too');
});

test('in a long phrase every seventh word has its letter, so no more than six blanks come in a row', () => {
  const t = tokenize('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen');
  assert.deepEqual([...phraseStarts(t)], [0, 7, 14]);
});

test('the letters a first letters go shows: every one, the start of each phrase, or the first word and the words missed before', () => {
  const t = tokenize('Tickets cost £35, and that’s the well-known price.');
  assert.deepEqual([...lettersShown(t, 'all')], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...lettersShown(t, 'phrases')], [0, 3]);
  assert.deepEqual([...lettersShown(t, 'missed', [7, 2, 7, 40])].sort((a, b) => a - b), [0, 2, 7]);
  assert.deepEqual([...lettersShown(tokenize('(Aside.) Not now.'), 'missed')], [1], 'the first word, not the direction before it');
});

test('a blank keeps the word’s punctuation, as the first letters do', () => {
  const [a, b, c] = tokenize('“Please,” she said.');
  assert.deepEqual([blankOf(a), blankOf(b), blankOf(c)], ['“_,”', '_', '_.']);
  assert.equal(blankOf(tokenize('£35,')[0]), '£_,');
  const t = tokenize('(Aside.) Not now.');
  assert.equal(blankOf(t[0]), '[Aside.]', 'a direction is shown as it is');
  const shown = lettersShown(tokenize('Tickets cost £35, and that’s the price.'), 'phrases');
  assert.equal(joinTokens(tokenize('Tickets cost £35, and that’s the price.'), (x, i) => (shown.has(i) ? firstLettersLine([x]) : blankOf(x))), 'T _ £_, a _ _ _.');
});
