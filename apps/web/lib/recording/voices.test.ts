import { describe, expect, it } from 'vitest';
import { groupVoices, MIN_VOICE_MS } from './voices';

const seg = (label: string, startMs: number, endMs: number) => ({ startMs, endMs, label, confidence: 0.9 });

describe('groupVoices', () => {
  const segments = [seg('S0', 0, 30_000), seg('S0', 40_000, 50_000), seg('S1', 30_000, 40_000), seg('S2', 50_000, 59_999), seg('S3', 60_000, 62_000), seg('S3', 70_000, 71_000)];
  it('lists voices with at least 10 s of speech, longest first', () => {
    const g = groupVoices(segments);
    expect(g.voices.map((v) => v.label)).toEqual(['S0', 'S1']);
    expect(g.voices[0]!.totalMs).toBe(40_000);
    expect(g.voices[0]!.longest.map((s) => s.startMs)).toEqual([0, 40_000]);
  });
  it('leaves shorter voices unattributed and counts them', () => {
    const g = groupVoices(segments);
    expect(g.shortLabels).toEqual(['S2', 'S3']);
    expect(MIN_VOICE_MS).toBe(10_000);
  });
  it('keeps exactly 10 s and handles no segments', () => {
    expect(groupVoices([seg('S0', 0, 10_000)]).voices).toHaveLength(1);
    expect(groupVoices([])).toEqual({ voices: [], shortLabels: [] });
  });
});
