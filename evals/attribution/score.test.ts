import { describe, expect, it } from 'vitest';
import { calibrate, gatePred, score } from './score';

const ref: [number, number, string][] = [[0, 1000, 'A'], [1000, 2000, 'B'], [2000, 3000, 'UNK']];

describe('score', () => {
  it('counts right, wrong-auto, held and missed as shares of reference speech', () => {
    const r = score(ref, [
      { startMs: 0, endMs: 1000, participantKey: 'A', confidence: 0.95, pending: false },
      { startMs: 1000, endMs: 1500, participantKey: 'A', confidence: 0.95, pending: false },
      { startMs: 2000, endMs: 3000, participantKey: 'A', confidence: 0.6, pending: true },
    ], 0.85);
    expect(r.correct).toBeCloseTo(2 / 3, 2);
    expect(r.wrongAuto).toBeCloseTo(1 / 6, 2);
    expect(r.missed).toBeCloseTo(1 / 6, 2);
  });
  it('overlapping reference speakers: matching either one is correct', () => {
    const r = score([[0, 1000, 'A'], [0, 1000, 'B']], [{ startMs: 0, endMs: 1000, participantKey: 'B', confidence: 1, pending: false }], 0.85);
    expect(r.wrongAuto).toBe(0);
  });
  it('a line below the threshold is held, whatever it says; a pending line is held at every threshold', () => {
    const p = [
      { startMs: 0, endMs: 1000, participantKey: 'A', confidence: 0.9, pending: false },
      { startMs: 1000, endMs: 2000, participantKey: 'B', confidence: 1, pending: true },
    ];
    expect(score(ref, p, 0.85).correct).toBeCloseTo(1 / 3, 2);
    expect(score(ref, p, 0.95)).toMatchObject({ correct: 0, held: 2 / 3 });
    expect(score(ref, p, 0.99).wrongAuto).toBe(0);
  });
  it('an auto debater over audience speech is wrong-auto', () => {
    const r = score([[0, 1000, 'UNK']], [{ startMs: 0, endMs: 1000, participantKey: 'A', confidence: 1, pending: false }], 0.85);
    expect(r.wrongAuto).toBe(1);
  });
});

describe('calibrate', () => {
  it('falls back to host-confirms-all when no threshold is safe', () => {
    const bad = { reference: ref, predicted: [{ startMs: 0, endMs: 3000, participantKey: 'B', confidence: 1, pending: false }] };
    expect(calibrate([bad])).toMatchObject({ threshold: 0.99, hostConfirmsAll: true });
  });
  it('picks the lowest threshold whose pooled wrong-auto is at most 2%', () => {
    const run = {
      reference: [[0, 10000, 'A']] as [number, number, string][],
      predicted: [
        { startMs: 0, endMs: 9000, participantKey: 'A', confidence: 0.95, pending: false },
        { startMs: 9000, endMs: 10000, participantKey: 'B', confidence: 0.86, pending: false },
      ],
    };
    expect(calibrate([run])).toMatchObject({ threshold: 0.88, hostConfirmsAll: false });
  });
});

describe('gatePred', () => {
  const base = { startMs: 0, endMs: 1000, participantKey: 'UNK', confidence: 0.84, pending: true };
  it('lifts only the voice-only cap: a capped line is scored on its uncapped score and candidate', () => {
    expect(gatePred('mono-live', { ...base, candidate: 'A', uncapped: 1 })).toMatchObject({ participantKey: 'A', confidence: 1, pending: false });
  });
  it('keeps lines pending for other reasons held at every threshold', () => {
    const noCandidate = gatePred('mono-live', { ...base, confidence: 0.6 });
    const lowScore = gatePred('mono-live', { ...base, confidence: 0.7, candidate: 'B' });
    for (const p of [noCandidate, lowScore]) {
      expect(p.pending).toBe(true);
      for (const t of [0.85, 0.99]) expect(score([[0, 1000, 'A']], [{ ...p, confidence: 1 }], t).wrongAuto).toBe(0);
    }
    expect(lowScore.participantKey).toBe('B');
  });
  it('leaves other setups as recorded', () => {
    const u = { ...base, candidate: 'A', uncapped: 1 };
    expect(gatePred('bleed', u)).toMatchObject({ participantKey: 'UNK', confidence: 0.84, pending: true });
  });
});
