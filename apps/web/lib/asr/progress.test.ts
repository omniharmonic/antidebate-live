import { describe, expect, it } from 'vitest';
import { aggregateProgress, emptyProgress } from './progress';

describe('aggregateProgress', () => {
  it('counts files in the order they start and sums bytes across them', () => {
    let s = emptyProgress();
    let r = aggregateProgress(s, { file: 'tokenizer.json', loaded: 100, total: 100 });
    s = r.state;
    expect(r.report).toEqual({ phase: 'download', fileNumber: 1, bytes: 100 });
    r = aggregateProgress(s, { file: 'encoder.onnx', loaded: 5_000, total: 600_000_000 });
    expect(r.report).toEqual({ phase: 'download', fileNumber: 2, bytes: 5_100 });
  });
  it('never reports a finished download while more files may follow', () => {
    const r = aggregateProgress(emptyProgress(), { file: 'a', loaded: 10, total: 10 });
    expect(r.report).not.toHaveProperty('fraction');
    expect(r.report.phase).toBe('download');
  });
  it('keeps bytes monotonic even if a callback repeats or goes backwards', () => {
    let s = emptyProgress();
    s = aggregateProgress(s, { file: 'a', loaded: 50, total: 100 }).state;
    const r = aggregateProgress(s, { file: 'a', loaded: 20, total: 100 });
    expect(r.report.bytes).toBe(50);
    expect(r.report.fileNumber).toBe(1);
  });
});
