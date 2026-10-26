import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyOf, tokenize, keyedCount, firstLettersLine, joinTokens } from '../src/tokens.js';

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
