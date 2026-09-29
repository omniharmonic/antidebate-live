import { describe, expect, it } from 'vitest';
import { mergeChunkWords, planChunks } from './chunks';

describe('planChunks', () => {
  it('covers the whole file with overlapping 60 s windows', () => {
    const c = planChunks(130_000);
    expect(c.map((x) => [x.startMs, x.endMs])).toEqual([[0, 60_000], [56_000, 116_000], [112_000, 130_000]]);
  });
  it('handles a file shorter than one window', () => expect(planChunks(5_000)).toEqual([{ index: 0, startMs: 0, endMs: 5_000 }]));
});

describe('mergeChunkWords', () => {
  it('keeps one copy of each word in the overlap', () => {
    const a = { startMs: 0, endMs: 60_000, words: [{ text: 'one', startMs: 55_000, endMs: 55_400 }, { text: 'two', startMs: 58_500, endMs: 59_000 }] };
    const b = { startMs: 56_000, endMs: 116_000, words: [{ text: 'two', startMs: 58_520, endMs: 59_010 }, { text: 'three', startMs: 60_500, endMs: 61_000 }] };
    expect(mergeChunkWords([a, b]).map((w) => w.text)).toEqual(['one', 'two', 'three']);
  });
});
