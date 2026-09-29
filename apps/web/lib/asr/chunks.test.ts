import { describe, expect, it } from 'vitest';
import { mergeChunkWords, planChunks } from './chunks';

describe('planChunks', () => {
  it('covers the whole file with overlapping 60 s windows', () => {
    const c = planChunks(130_000);
    expect(c.map((x) => [x.startMs, x.endMs])).toEqual([[0, 60_000], [56_000, 116_000], [112_000, 130_000]]);
  });
  it('handles a file shorter than one window', () => expect(planChunks(5_000)).toEqual([{ index: 0, startMs: 0, endMs: 5_000 }]));
  it('throws RangeError when windowMs <= overlapMs', () => {
    expect(() => planChunks(100_000, 4_000, 4_000)).toThrow(RangeError);
    expect(() => planChunks(100_000, 4_000, 5_000)).toThrow(RangeError);
  });
});

describe('mergeChunkWords', () => {
  it('keeps one copy of each word in the overlap', () => {
    const a = { startMs: 0, endMs: 60_000, words: [{ text: 'one', startMs: 55_000, endMs: 55_400 }, { text: 'two', startMs: 58_500, endMs: 59_000 }] };
    const b = { startMs: 56_000, endMs: 116_000, words: [{ text: 'two', startMs: 58_520, endMs: 59_010 }, { text: 'three', startMs: 60_500, endMs: 61_000 }] };
    expect(mergeChunkWords([a, b]).map((w) => w.text)).toEqual(['one', 'two', 'three']);
  });
  it('handles three chunks with words in overlaps', () => {
    const a = { startMs: 0, endMs: 60_000, words: [{ text: 'early', startMs: 57_000, endMs: 57_400 }, { text: 'middle', startMs: 59_000, endMs: 59_500 }] };
    const b = { startMs: 56_000, endMs: 116_000, words: [{ text: 'early', startMs: 57_050, endMs: 57_450 }, { text: 'middle', startMs: 59_100, endMs: 59_600 }, { text: 'late', startMs: 115_000, endMs: 115_400 }] };
    const c = { startMs: 112_000, endMs: 172_000, words: [{ text: 'late', startMs: 115_100, endMs: 115_500 }] };
    expect(mergeChunkWords([a, b, c]).map((w) => w.text)).toEqual(['early', 'middle', 'late']);
  });
});
