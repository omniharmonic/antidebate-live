import { describe, expect, it } from 'vitest';
import { groupReview } from './review';
import type { ReviewLine } from './pipeline';

const line = (utteranceId: string, diarLabel?: string): ReviewLine => ({ utteranceId, text: utteranceId, startMs: 0, endMs: 1, candidates: {}, ...(diarLabel ? { diarLabel } : {}) });

describe('groupReview', () => {
  it('groups lines by voice label and lists unlabelled lines individually, in order', () => {
    const g = groupReview([line('a', 'S0'), line('b'), line('c', 'S1'), line('d', 'S0'), line('e')]);
    expect(g.map((x) => [x.label, x.lines.map((l) => l.utteranceId)])).toEqual([['S0', ['a', 'd']], [null, ['b']], ['S1', ['c']], [null, ['e']]]);
  });
});
