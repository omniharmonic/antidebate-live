import { describe, expect, it } from 'vitest';
import { AUTO_THRESHOLD, fuse, needsOperator } from './fusion';

// fusion.py maps voiceprint cosine s to (s-0.4)/0.4; the Python cases use s=0.82 → 1.0 and s=0.55 → 0.375.
describe('fuse (parity with fusion.py)', () => {
  it('clean channel + voice + diarizer agree → auto', () => {
    const c = fuse({ channelMarginDb: 14, voiceMatch: 1, diarizerAgrees: true, overlap: false });
    expect(c).toBe(1);
    expect(needsOperator(c)).toBe(false);
  });
  it('weak margin, weak voice, overlap → operator', () => {
    const c = fuse({ channelMarginDb: 2, voiceMatch: 0.375, diarizerAgrees: null, overlap: true });
    expect(c).toBe(0.202);
    expect(needsOperator(c)).toBe(true);
  });
  it('no signals → 0', () => expect(fuse({ channelMarginDb: null, voiceMatch: null, diarizerAgrees: null, overlap: false })).toBe(0));
  it('voice only, strong → auto; threshold is 0.85', () => {
    expect(fuse({ channelMarginDb: null, voiceMatch: 0.9, diarizerAgrees: null, overlap: false })).toBe(0.9);
    expect(AUTO_THRESHOLD).toBe(0.85);
  });
});
