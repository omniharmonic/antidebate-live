// apps/web/lib/attribution/anchors.test.ts
import { describe, expect, it } from 'vitest';
import { buildMatchInput, enrollmentError, scoreFromSegments, speechSeconds, trimAnchor } from './anchors';

const sec = (s: number, amp = 0.2) => Float32Array.from({ length: 16_000 * s }, (_, i) => amp * Math.sin(i / 3));

describe('buildMatchInput', () => {
  it('lays out anchors, gaps and the utterance with media spans', () => {
    const { samples, spans } = buildMatchInput([{ key: 'A', pcm: sec(2) }, { key: 'B', pcm: sec(2) }], sec(1));
    expect(spans).toEqual([{ key: 'A', startMs: 0, endMs: 2000 }, { key: 'B', startMs: 2500, endMs: 4500 }, { key: '__utt__', startMs: 5000, endMs: 6000 }]);
    expect(samples.length).toBe(16_000 * 6);
  });
});

describe('scoreFromSegments', () => {
  const spans = [{ key: 'A', startMs: 0, endMs: 2000 }, { key: 'B', startMs: 2500, endMs: 4500 }, { key: '__utt__' as const, startMs: 5000, endMs: 6000 }];
  it('scores the share of the utterance on each anchor\u2019s label', () => {
    const segs = [{ startMs: 0, endMs: 2000, label: 'S0', confidence: 1 }, { startMs: 2500, endMs: 4500, label: 'S1', confidence: 1 }, { startMs: 5000, endMs: 5800, label: 'S1', confidence: 1 }, { startMs: 5800, endMs: 6000, label: 'S2', confidence: 1 }];
    expect(scoreFromSegments(segs, spans)).toEqual({ A: 0, B: 0.8 });
  });
  it('two anchors on one label are ambiguous, both 0', () => {
    const segs = [{ startMs: 0, endMs: 4500, label: 'S0', confidence: 1 }, { startMs: 5000, endMs: 6000, label: 'S0', confidence: 1 }];
    expect(scoreFromSegments(segs, spans)).toEqual({ A: 0, B: 0 });
  });
});

describe('speechSeconds', () => {
  it('counts speech, not silence', () => {
    const pcm = new Float32Array(16_000 * 20);
    pcm.set(sec(6), 16_000 * 3);
    expect(speechSeconds(pcm)).toBeGreaterThan(5);
    expect(speechSeconds(pcm)).toBeLessThan(7.5);
  });
});

describe('trimAnchor', () => {
  it('keeps at most 8 s by default, from the loudest stretch', () => {
    const pcm = new Float32Array(16_000 * 30);
    pcm.set(sec(10, 0.05), 0);
    pcm.set(sec(12, 0.4), 16_000 * 16);
    const out = trimAnchor(pcm);
    expect(out.length).toBe(16_000 * 8);
    expect(out.reduce((m, v) => Math.max(m, v), 0)).toBeGreaterThan(0.3);
  });
  it('returns short speech whole, without the silence', () => {
    const pcm = new Float32Array(16_000 * 10);
    pcm.set(sec(3), 16_000 * 2);
    const out = trimAnchor(pcm);
    expect(out.length / 16_000).toBeGreaterThan(2.9);
    expect(out.length / 16_000).toBeLessThan(3.5);
  });
});

describe('enrollmentError', () => {
  it('asks to record again under 10 s of speech', () => {
    expect(enrollmentError('Ana', sec(6))).toBe('We heard less than 10 seconds of speech from Ana. Record again.');
    const long = new Float32Array(16_000 * 16);
    long.set(sec(12), 16_000 * 2);
    expect(enrollmentError('Ana', long)).toBeNull();
  });
});
