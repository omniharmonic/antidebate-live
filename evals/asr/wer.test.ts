import { describe, expect, it } from 'vitest';
import { wer } from './wer';

describe('wer', () => {
  it('ignores case and punctuation', () => expect(wer('Taxes should fall.', 'taxes should fall')).toBe(0));
  it('counts one substitution in four words as 0.25', () => expect(wer('a b c d', 'a x c d')).toBe(0.25));
  it('treats a curly apostrophe as a straight one', () => expect(wer("don't stop", 'don\u2019t stop')).toBe(0));
  it('counts insertions and deletions against the reference length', () => {
    expect(wer('a b c d', 'a b c')).toBe(0.25);
    expect(wer('a b', 'a b c d')).toBe(1);
  });
  it('is 0 for two empty texts and 1 for a missing hypothesis', () => {
    expect(wer('', '')).toBe(0);
    expect(wer('a b', '')).toBe(1);
  });
});
