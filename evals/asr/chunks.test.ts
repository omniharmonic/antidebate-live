import { describe, expect, it } from 'vitest';
import { chunkDecision, type ChunkRun } from './chunks';

const run = (chunkMs: number, windows: [number, number][], rtf = 9): ChunkRun => ({ chunkMs, realtimeFactor: rtf, windows: windows.map(([refWords, errors], i) => ({ fixture: 'f', startMs: i * 60_000, refWords, errors, deletions: errors })) });

describe('chunkDecision (ruling P3-R12)', () => {
  it('switches to 30 s when pooled WER improves by 2 points, no window worsens by more than 1 point, and RTF stays at least 2x', () => {
    const d = chunkDecision(run(60_000, [[100, 10], [100, 10]]), run(30_000, [[100, 6], [100, 10]]));
    expect(d).toMatchObject({ switchTo30: true, pooled60: 0.1, pooled30: 0.08, worstWorsening: 0 });
  });
  it('keeps 60 s when the gain is under 2 points', () => {
    expect(chunkDecision(run(60_000, [[100, 10]]), run(30_000, [[100, 9]])).switchTo30).toBe(false);
  });
  it('keeps 60 s when any window gets worse by more than 1 point', () => {
    const d = chunkDecision(run(60_000, [[100, 10], [100, 2]]), run(30_000, [[100, 2], [100, 5]]));
    expect(d).toMatchObject({ switchTo30: false, worstWorsening: 0.03 });
  });
  it('keeps 60 s when 30 s chunks run under 2x real time', () => {
    expect(chunkDecision(run(60_000, [[100, 10]]), run(30_000, [[100, 2]], 1.9)).switchTo30).toBe(false);
  });
});
